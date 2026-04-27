import type { Segment } from "./types";

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** 把含 ``` 代码块的 markdown 切成 文本/代码 段，按出现顺序保留。 */
export function splitByCodeBlocks(markdown: string): Segment[] {
  const out: Segment[] = [];
  const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    if (m.index > last) {
      const text = markdown.slice(last, m.index).trim();
      if (text) out.push({ kind: "text", text });
    }
    out.push({ kind: "code", lang: m[1] || "", code: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < markdown.length) {
    const text = markdown.slice(last).trim();
    if (text) out.push({ kind: "text", text });
  }
  return out;
}

/** AI provider 错误是否值得自动重试（瞬时网络/上游过载/限流）。 */
export function isRetryable(e: unknown): boolean {
  const s = String(e);
  // 上游过载 / 限流 / 网关瞬时错误：Anthropic 529、429、502/503/504、fetch network
  if (/\b(429|529|502|503|504)\b/.test(s)) return true;
  if (/overloaded_error|rate[_ ]?limit|timeout|network|ECONN/i.test(s)) return true;
  return false;
}

/** 把 AI provider 错误映射成给用户看的简短中文提示。 */
export function friendlyError(e: unknown): string {
  const raw = String(e);
  if (/529|overloaded_error/i.test(raw))
    return "模型服务当前过载（上游 529），已自动重试仍失败。稍后再试，或换一个 Provider。";
  if (/\b429\b|rate[_ ]?limit/i.test(raw))
    return "触发了 Provider 速率限制（429）。稍等一会再发。";
  if (/\b401\b|invalid[_ ]?api[_ ]?key/i.test(raw))
    return "API Key 无效或已过期，请在「管理」里更新。";
  if (/network|ECONN|fetch/i.test(raw)) return `网络错误：${raw}`;
  return raw;
}

/** AI 给的命令含明显破坏性 → 给用户加红色二次确认条。 */
export function isDangerousCmd(s: string): boolean {
  if (/\brm\s+-[rRf]+\b.*\s\//.test(s)) return true;
  if (/\bdd\s+if=/.test(s)) return true;
  if (/\bmkfs\./.test(s)) return true;
  if (/\b(shutdown|reboot|halt|poweroff)\b/.test(s)) return true;
  if (/>\s*\/dev\/sd[a-z]/.test(s)) return true;
  return false;
}
