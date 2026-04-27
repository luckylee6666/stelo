import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSessionStore } from "../stores/sessions";
import { redactWithReport } from "./redact";

const LS_STRICT_REDACT = "hypershell.aiStrictRedact";

/** 严格模式默认开。命中脱敏规则时整段输出对 AI 屏蔽（只发提示），避免漏检的字段也跟着泄露。 */
export function isStrictRedactEnabled(): boolean {
  const v = localStorage.getItem(LS_STRICT_REDACT);
  return v === null ? true : v !== "false";
}

export function setStrictRedactEnabled(on: boolean) {
  localStorage.setItem(LS_STRICT_REDACT, on ? "true" : "false");
}

export const OSC7_REGEX = /\x1b\]7;[^\x1b\x07]*(?:\x1b\\|\x07)/;

export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\]7;[^\x1b\x07]*(?:\x1b\\|\x07)/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\r/g, "");
}

/** 检测 buffer 尾部是否在等交互输入。返回 null / "password" / "confirm"。 */
export function detectInteractivePrompt(
  tail: string,
): "password" | "confirm" | null {
  // 只看最后几行，避免误匹配历史输出里的"password"字样
  const lines = tail.split("\n");
  const recent = lines.slice(-3).join("\n").trim();
  if (!recent) return null;
  if (/\[sudo\]\s*password\s+for\s+\S+[:：]\s*$/im.test(recent)) return "password";
  if (/\b(password|passphrase|passwd)[^:\n]{0,40}[:：]\s*$/im.test(recent))
    return "password";
  if (/enter\s+passphrase.*[:：]\s*$/im.test(recent)) return "password";
  if (/\[y\/n\]\s*\??\s*$/im.test(recent)) return "confirm";
  if (/\[Y\/n\]\s*\??\s*$/.test(recent)) return "confirm";
  if (/\(yes\/no(?:\/[^)]+)?\)\??\s*$/im.test(recent)) return "confirm";
  if (/continue\s+connecting\?/im.test(recent)) return "confirm";
  return null;
}

export interface CaptureOptions {
  /** 距离上一次字节到达多久没动静视为卡住（默认 30s）。长任务只要还在输出进度就继续等。 */
  idleTimeoutMs?: number;
  /** 硬上限（默认 10min），防止极端情况死等。 */
  maxTimeoutMs?: number;
  /** 每 ~1s 回调一次，用于在 UI 显示"已等待 Xs"。 */
  onProgress?: (info: { elapsedMs: number; idleMs: number; bytes: number }) => void;
}

/** 发送命令并抓取输出直到下一个 prompt（OSC 7）、长时间空闲或超总上限。返回清理过的纯文本。 */
export async function runAndCapture(
  command: string,
  opts: CaptureOptions = {},
): Promise<string> {
  const idleTimeoutMs = opts.idleTimeoutMs ?? 30000;
  const maxTimeoutMs = opts.maxTimeoutMs ?? 600000;
  const state = useSessionStore.getState();
  const active = state.sessions.find((s) => s.id === state.activeId);
  if (!active?.backendId) throw new Error("未连接到任何 SSH 会话");
  const bid = active.backendId;

  let buffer = "";
  let sawOsc7 = false;
  let lastByteAt = Date.now();
  const unlisten = await listen<string>(`ssh:data:${bid}`, (e) => {
    const raw = atob(e.payload);
    buffer += raw;
    lastByteAt = Date.now();
    if (OSC7_REGEX.test(raw)) sawOsc7 = true;
  });

  let hitIdleTimeout = false;
  let hitMaxTimeout = false;
  let interactivePrompt: "password" | "confirm" | null = null;
  try {
    await invoke("ssh_send", { sessionId: bid, data: command + "\r" });
    const start = Date.now();
    let lastProgressAt = 0;
    while (true) {
      const now = Date.now();
      if (sawOsc7) {
        await new Promise((r) => setTimeout(r, 120));
        break;
      }
      if (now - start >= maxTimeoutMs) {
        hitMaxTimeout = true;
        break;
      }
      if (now - lastByteAt >= idleTimeoutMs) {
        hitIdleTimeout = true;
        break;
      }
      // 字节刚停歇就扫一眼尾部，是不是在等密码/y-N。比等到 idleTimeout(30s) 再 bail 友好得多。
      if (now - lastByteAt >= 1500 && buffer.length > 0) {
        const kind = detectInteractivePrompt(stripAnsi(buffer));
        if (kind) {
          interactivePrompt = kind;
          break;
        }
      }
      if (opts.onProgress && now - lastProgressAt >= 1000) {
        lastProgressAt = now;
        opts.onProgress({
          elapsedMs: now - start,
          idleMs: now - lastByteAt,
          bytes: buffer.length,
        });
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  } finally {
    unlisten();
  }

  const rawText = stripAnsi(buffer).trim();
  // 去掉命令回显那一行（通常是 "prompt cmd"）
  const lines = stripAnsi(buffer).split("\n");
  const firstCmdLineIdx = lines.findIndex((l) => l.includes(command));
  if (firstCmdLineIdx >= 0) {
    lines.splice(0, firstCmdLineIdx + 1);
  }
  // 去末尾新 shell prompt（只匹配 $/#/%/>，避免误删 `password for xxx:` 这类交互提示）
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (/^[\w.@:~/\\-]*\s*[$#>%]\s*$/.test(last) || last === "") {
      lines.pop();
    } else break;
  }
  let text = lines.join("\n").trim();

  // 裁剪后空了但原始 buffer 非空 → 回退用原始 stripAnsi，保留 sudo/vim/less 等交互提示
  if (!text && rawText) text = rawText;

  // 没收到 OSC 7：AI 必须知道命令未正常结束
  if (!sawOsc7) {
    const warning = interactivePrompt === "password"
      ? "[🔐 NEEDS_PASSWORD 命令卡在密码提示（sudo / SSH 私钥 passphrase 等）。**不要再发新命令**——任何新字节都会被当成密码送给那个进程。告知用户需要在终端里输入密码。]"
      : interactivePrompt === "confirm"
        ? "[❓ NEEDS_CONFIRM 命令卡在 y/N 或 yes/no 确认。**不要再发新命令**；告知用户需要在终端里输入 y / yes 回车。]"
        : hitIdleTimeout
          ? "[⚠ 命令长时间无新输出——很可能卡在交互提示（vim/less 等）或终端被其他程序占用。不要假定成功，也不要再发新命令；告知用户手动处理，或改用非交互方式（DEBIAN_FRONTEND=noninteractive apt-get -y、sudo -n、curl -fSL 等）]"
          : hitMaxTimeout
            ? "[⚠ 达到最长等待时间但命令仍在运行。这是一个超长任务（编译/大下载），可以再发一条轻量校验命令（如 `ls -la 目标路径` 或 `pgrep -x 进程名`）隔开轮询，而不是重跑整个命令]"
            : "[⚠ 未收到 shell prompt，命令状态不明]";
    text = text ? `${warning}\n\n${text}` : warning;
  }

  // 脱敏后再截断/返回——避免把 token / 密码 / Bearer 头送进 AI provider 的请求体
  const { text: redactedText, hits } = redactWithReport(text);
  text = redactedText;
  if (hits > 0) {
    if (isStrictRedactEnabled()) {
      // 严格模式：哪怕规则可能漏检，整段输出都不发给 AI，只发结构化提示
      text = `[🛡 SENSITIVE_OUTPUT_BLOCKED 命令输出含敏感数据（${hits} 类规则命中：密码 / token / API key 等），已在严格模式下被屏蔽，未发送给 AI provider。请告知用户输出含敏感内容、由用户自行查看终端，或者关闭"AI 严格脱敏"后重试。]`;
    } else {
      text = `[🛡 REDACTED 命令输出含 ${hits} 类敏感数据（密码 / token / API key），已自动替换为 ***。AI 看到的是脱敏后的结果。]\n\n${text}`;
    }
  }
  if (text.length > 4000) text = "...(head 截断)\n" + text.slice(-4000);
  return text;
}
