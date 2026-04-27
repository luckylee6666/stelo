import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useAiStore } from "../stores/aiProviders";
import { useSessionStore } from "../stores/sessions";
import {
  chatStream,
  chatAgent,
  buildContextSystem,
  extractCodeBlocks,
  getActiveProvider,
  sendCommandToActive,
  type ChatMessage,
  type AgentMessage,
  type AgentContentBlock,
} from "../lib/ai";
import { runAndCapture } from "../lib/agent";
import { cn } from "../lib/utils";
import {
  Sparkles,
  X,
  Play,
  ClipboardCopy,
  Trash2,
  Check,
  AlertTriangle,
  Settings,
  Loader2,
  Bot,
  Terminal,
  Square,
  Paperclip,
  KeyRound,
  HelpCircle,
  RefreshCw,
  Folder,
  Wrench,
} from "lucide-react";

type Attachment = {
  localPath: string;
  name: string;
  kind: "file" | "dir";
  status: "pending" | "uploading" | "done" | "error";
  remotePath?: string;
  error?: string;
};

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

const LS_AGENT = "hypershell.aiAgentMode";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenManager: () => void;
};

type Turn = {
  role: "user" | "assistant" | "exec";
  content: string;
  command?: string;
};

export function AiPanel({ onClose, onOpenManager }: Props) {
  const providers = useAiStore((s) => s.providers);
  const activeId = useAiStore((s) => s.activeId);
  const setActive = useAiStore((s) => s.setActive);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<boolean>(
    () => localStorage.getItem(LS_AGENT) === "1",
  );
  const toggleAgent = (v: boolean) => {
    localStorage.setItem(LS_AGENT, v ? "1" : "0");
    setAgentMode(v);
  };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // 上次 ask 的最终 prompt，用于 529 等失败后"重试 / 换 Provider"按钮
  const lastAskRef = useRef<{ prompt: string; agent: boolean } | null>(null);
  const [errorRetryable, setErrorRetryable] = useState(false);
  const pickFiles = async () => {
    try {
      const picked = await openFileDialog({ multiple: true });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      setAttachments((prev) => [
        ...prev,
        ...paths.map<Attachment>((p) => ({
          localPath: p,
          name: basename(p),
          kind: "file",
          status: "pending",
        })),
      ]);
    } catch (e) {
      setError(`选择文件失败: ${e}`);
    }
  };
  const pickDir = async () => {
    try {
      const picked = await openFileDialog({ directory: true, multiple: false });
      if (!picked) return;
      const p = Array.isArray(picked) ? picked[0] : picked;
      setAttachments((prev) => [
        ...prev,
        { localPath: p, name: basename(p), kind: "dir", status: "pending" },
      ]);
    } catch (e) {
      setError(`选择文件夹失败: ${e}`);
    }
  };
  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };
  /** 把所有 pending 附件 SFTP 上传到远端 /tmp/，返回给 AI 的上下文文本。 */
  const uploadAttachments = async (): Promise<string> => {
    if (attachments.length === 0) return "";
    const active = useSessionStore.getState().sessions.find(
      (s) => s.id === useSessionStore.getState().activeId,
    );
    if (!active?.backendId || active.kind !== "ssh") {
      throw new Error("请先在一个已连接的 SSH 会话里再附文件（本地终端不支持 SFTP 上传）");
    }
    const bid = active.backendId;
    const uploaded: Attachment[] = [];
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      if (a.status === "done" && a.remotePath) {
        uploaded.push(a);
        continue;
      }
      setAttachments((prev) =>
        prev.map((x, j) => (j === i ? { ...x, status: "uploading" } : x)),
      );
      setProgress(
        `上传${a.kind === "dir" ? "文件夹" : "文件"} ${a.name} (${i + 1}/${attachments.length})…`,
      );
      // basename 作为远端名，避免本地路径空格/中文带进命令；目录保留结构
      const remotePath = `/tmp/${a.name}`;
      try {
        if (a.kind === "dir") {
          await invoke<string>("sftp_upload_dir", {
            sessionId: bid,
            localPath: a.localPath,
            remotePath,
          });
        } else {
          await invoke<string>("sftp_upload", {
            sessionId: bid,
            localPath: a.localPath,
            remotePath,
          });
        }
        const done: Attachment = { ...a, status: "done", remotePath };
        uploaded.push(done);
        setAttachments((prev) => prev.map((x, j) => (j === i ? done : x)));
      } catch (e) {
        const err: Attachment = { ...a, status: "error", error: String(e) };
        setAttachments((prev) => prev.map((x, j) => (j === i ? err : x)));
        throw new Error(`上传 ${a.name} 失败: ${e}`);
      }
    }
    const lines = uploaded
      .map((a) =>
        a.kind === "dir"
          ? `- \`${a.remotePath}/\`（本地文件夹 \`${a.name}\`，整棵目录树已递归上传到此路径下）`
          : `- \`${a.remotePath}\`（本地文件 \`${a.name}\`）`,
      )
      .join("\n");
    // 上传后自动在右侧文件面板定位到对应目录——单项文件夹直接进入其中；否则打开父目录 /tmp
    const showPath =
      uploaded.length === 1 && uploaded[0].kind === "dir"
        ? uploaded[0].remotePath!
        : "/tmp";
    window.dispatchEvent(
      new CustomEvent("hyper:open-file-panel", { detail: { backendId: bid } }),
    );
    // 推迟一拍让 CwdPanel 挂载并注册事件监听，否则首次触发会吃不到 show-remote-path
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("hyper:show-remote-path", {
          detail: { backendId: bid, path: showPath },
        }),
      );
    }, 60);
    return `[已通过 SFTP 上传以下本地内容到远端，你可以直接 cat / bash / chmod / cp / mv / ls -R 等操作：\n${lines}]\n\n`;
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCompositionEnd = useRef(0);
  const stopRequestedRef = useRef(false);
  const historyRef = useRef<ChatMessage[]>([]);
  /** Agent 模式专用历史，保留完整 tool_use / tool_result 内容块——跨轮不能用 historyRef 扁平化版本，
   * 否则 AI 会把"[调用工具: ...]"兜底字符串当自己的前文并复读。 */
  const agentHistoryRef = useRef<AgentMessage[]>([]);

  useEffect(() => {
    setError(null);
    setFlash(null);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, loading]);

  const activeProvider = providers.find((p) => p.id === activeId);

  /** 核心调用：根据 agent 标志走 Agent 循环或流式 chat。抛错时回滚 history。 */
  const doCall = async (prompt: string, agent: boolean) => {
    const historySnapshot = historyRef.current.length;
    try {
      if (agent) {
        await runAgentLoop(prompt);
      } else {
        const provider = getActiveProvider();
        if (!provider) throw new Error("未选择 AI 模型");
        historyRef.current.push({ role: "user", content: prompt });
        const messages: ChatMessage[] = [
          { role: "system", content: buildContextSystem(false) },
          ...historyRef.current,
        ];
        // 先插一个空的 assistant turn，随 stream 不断刷新 content
        setTurns((t) => [...t, { role: "assistant", content: "" }]);
        const reply = await chatStreamWithRetry(provider, messages, (delta) => {
          setTurns((t) => {
            if (t.length === 0) return t;
            const last = t[t.length - 1];
            if (last.role !== "assistant") return t;
            return [...t.slice(0, -1), { ...last, content: last.content + delta }];
          });
        });
        historyRef.current.push({ role: "assistant", content: reply });
      }
      setErrorRetryable(false);
    } catch (e) {
      if (historyRef.current.length > historySnapshot) {
        const last = historyRef.current[historyRef.current.length - 1];
        if (last?.role !== "assistant") {
          historyRef.current.length = historySnapshot;
        }
      }
      setError(friendlyError(e));
      setErrorRetryable(isRetryable(e));
    }
  };

  const ask = async () => {
    const rawPrompt = input.trim();
    if ((!rawPrompt && attachments.length === 0) || loading) return;
    if (!activeProvider) {
      setError("还没配置 AI 模型，点右上 '管理' 添加一个");
      return;
    }
    setError(null);
    setErrorRetryable(false);
    setLoading(true);
    setProgress(null);
    stopRequestedRef.current = false;
    try {
      // 先把附件上传，拿到远端路径注入到 prompt 前
      let ctx = "";
      if (attachments.length > 0) ctx = await uploadAttachments();
      const prompt = ctx + (rawPrompt || "请处理上面上传的文件");
      const displayPrompt = attachments.length > 0
        ? `${rawPrompt}\n\n📎 附件：${attachments.map((a) => a.name).join("、")}`
        : rawPrompt;
      setTurns((t) => [...t, { role: "user", content: displayPrompt }]);
      setInput("");
      setAttachments([]);
      lastAskRef.current = { prompt, agent: agentMode };
      await doCall(prompt, agentMode);
    } catch (e) {
      setError(friendlyError(e));
      setErrorRetryable(false);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  /** 失败后重试上一次请求——不重新上传附件（已在 /tmp），直接再发。 */
  const retryLast = async () => {
    const last = lastAskRef.current;
    if (!last || loading) return;
    if (!activeProvider) {
      setError("还没配置 AI 模型，点右上 '管理' 添加一个");
      return;
    }
    setError(null);
    setErrorRetryable(false);
    setLoading(true);
    setProgress(null);
    stopRequestedRef.current = false;
    try {
      await doCall(last.prompt, last.agent);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  /** 切到另一个 Provider 后自动重试。 */
  const switchProviderAndRetry = async (providerId: string) => {
    setActive(providerId);
    await new Promise((r) => setTimeout(r, 30));
    await retryLast();
  };

  /** 密码/确认类交互：用户在终端处理完后点"继续"，给 AI 发信号恢复。 */
  const continueAfterAuth = async () => {
    if (loading) return;
    const prompt = "我已在终端完成密码/确认输入。请用一条轻量校验命令（如 pgrep / ls / dpkg -l | grep）确认刚才那条命令是否完成，然后继续下一步。";
    setTurns((t) => [...t, { role: "user", content: prompt }]);
    setError(null);
    setErrorRetryable(false);
    setLoading(true);
    setProgress(null);
    stopRequestedRef.current = false;
    lastAskRef.current = { prompt, agent: agentMode };
    try {
      await doCall(prompt, agentMode);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const stopAgent = () => {
    stopRequestedRef.current = true;
    setProgress("正在停止…（等当前这轮结束）");
  };


  /** 流式非 Agent chat + 重试（529 等） */
  const chatStreamWithRetry = async (
    provider: ReturnType<typeof getActiveProvider> & object,
    messages: ChatMessage[],
    onChunk: (delta: string) => void,
  ): Promise<string> => {
    const delays = [800, 2000, 4000];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (stopRequestedRef.current) throw new Error("已停止");
      try {
        return await chatStream(provider, messages, { onChunk });
      } catch (e) {
        lastErr = e;
        if (!isRetryable(e) || attempt === delays.length) throw e;
        setProgress(
          `模型服务繁忙，${Math.round(delays[attempt] / 1000)}s 后重试（${attempt + 1}/${delays.length}）…`,
        );
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
    throw lastErr;
  };

  const runAgentLoop = async (userPrompt: string) => {
    const provider = getActiveProvider();
    if (!provider) throw new Error("未选择 AI 模型");
    historyRef.current.push({ role: "user", content: userPrompt });

    // Agent 历史用 agentHistoryRef 跨轮持久化 rawBlocks（tool_use / tool_result 原样保留）。
    // 第一次进来时 system prompt 还没设，初始化它。
    if (agentHistoryRef.current.length === 0) {
      agentHistoryRef.current.push({
        role: "system",
        content: buildContextSystem(true),
      });
    }
    agentHistoryRef.current.push({ role: "user", content: userPrompt });

    let round = 0;
    while (!stopRequestedRef.current) {
      round++;
      setProgress(`思考中（第 ${round} 轮 · 点 停止 可中断）…`);

      // 插一个空的 assistant turn 供 stream 增量填充
      setTurns((t) => [...t, { role: "assistant", content: "" }]);

      let result: Awaited<ReturnType<typeof chatAgent>>;
      try {
        result = await callAgentWithRetry(provider, agentHistoryRef.current);
      } catch (e) {
        // 流式阶段失败：把占位 turn 收走，让 doCall 统一设 error。
        // agentHistoryRef 保留到当前位置（下次 retry 可复用），先把本轮已 push 的 user prompt 回滚
        setTurns((t) => {
          if (t.length === 0 || t[t.length - 1].role !== "assistant") return t;
          if (t[t.length - 1].content === "") return t.slice(0, -1);
          return t;
        });
        throw e;
      }
      if (stopRequestedRef.current) break;

      // 流结束后如果文字段空（模型只给了 tool_use），把占位改为"工具调用占位符"
      setTurns((t) => {
        if (t.length === 0 || t[t.length - 1].role !== "assistant") return t;
        const last = t[t.length - 1];
        if (last.content) return t;
        if (result.toolCalls.length > 0) {
          return [
            ...t.slice(0, -1),
            { ...last, content: `__TOOL_CALL_PLACEHOLDER__:${result.toolCalls.length}` },
          ];
        }
        return t.slice(0, -1); // 什么都没有就收掉
      });

      // 富内容放回 agentHistoryRef 供下一轮（rawBlocks 是 AI 真正的 tool_use 结构）
      agentHistoryRef.current.push({
        role: "assistant",
        content: result.rawBlocks,
      });
      // historyRef 只存 AI 的纯文字思考，不包括 tool_use 描述（防跨轮污染）
      if (result.text) {
        historyRef.current.push({ role: "assistant", content: result.text });
      }

      // 没有 tool_use → fallback：解析 ```bash 代码块，或 "[调用工具: XXX]" 兜底文本
      if (result.toolCalls.length === 0) {
        const codeBlocks = extractCodeBlocks(result.text).map((b) => b.code);
        const textCalls = extractToolCallFromText(result.text);
        const all = [...codeBlocks, ...textCalls].filter((c) => !isDangerousCmd(c));
        if (all.length === 0) break;
        const outputs: string[] = [];
        for (const code of all) {
          if (stopRequestedRef.current) break;
          const out = await runOneCommand(code);
          setTurns((t) => [
            ...t,
            { role: "exec", content: out, command: code },
          ]);
          outputs.push(
            `### 命令\n\`\`\`bash\n${code}\n\`\`\`\n### 输出\n\`\`\`\n${out || "(无输出)"}\n\`\`\``,
          );
        }
        if (stopRequestedRef.current) break;
        const msg = outputs.join("\n\n");
        agentHistoryRef.current.push({ role: "user", content: msg });
        historyRef.current.push({ role: "user", content: msg });
        continue;
      }

      // 有 tool_use → 按顺序跑，收集 tool_result 回给 AI
      const toolResults: AgentContentBlock[] = [];
      const flatOutputs: string[] = [];
      for (const call of result.toolCalls) {
        if (stopRequestedRef.current) break;
        if (isDangerousCmd(call.command)) {
          const msg = `[⚠ 拒绝执行危险命令：${call.command}]`;
          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: msg,
          });
          setTurns((t) => [
            ...t,
            { role: "exec", content: msg, command: call.command },
          ]);
          flatOutputs.push(`$ ${call.command}\n${msg}`);
          continue;
        }
        const out = await runOneCommand(call.command);
        setTurns((t) => [
          ...t,
          { role: "exec", content: out, command: call.command },
        ]);
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: out || "(无输出)",
        });
        flatOutputs.push(`$ ${call.command}\n${out}`);
      }
      if (stopRequestedRef.current) break;
      agentHistoryRef.current.push({ role: "user", content: toolResults });
      historyRef.current.push({
        role: "user",
        content: flatOutputs.join("\n\n"),
      });
    }
  };

  /** 兜底解析："[调用工具: xxx]" 这种 AI 在 tool_use 不支持时吐的文字里提命令。 */
  const extractToolCallFromText = (text: string): string[] => {
    const out: string[] = [];
    const re = /\[调用工具:\s*([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const cmd = m[1].trim();
      if (cmd) out.push(cmd);
    }
    return out;
  };

  const callAgentWithRetry = async (
    provider: ReturnType<typeof getActiveProvider> & object,
    agentHistory: AgentMessage[],
  ): Promise<Awaited<ReturnType<typeof chatAgent>>> => {
    const delays = [800, 2000, 4000];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (stopRequestedRef.current) throw new Error("已停止");
      try {
        return await chatAgent(provider, agentHistory, {
          onTextDelta: (delta) => {
            setTurns((t) => {
              if (t.length === 0) return t;
              const last = t[t.length - 1];
              if (last.role !== "assistant") return t;
              return [
                ...t.slice(0, -1),
                { ...last, content: last.content + delta },
              ];
            });
          },
        });
      } catch (e) {
        lastErr = e;
        if (!isRetryable(e) || attempt === delays.length) throw e;
        setProgress(
          `模型服务繁忙，${Math.round(delays[attempt] / 1000)}s 后重试（${attempt + 1}/${delays.length}）…`,
        );
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
    throw lastErr;
  };

  /** 跑单条命令并在 progress 条里显示实时用时/空闲秒数。 */
  const runOneCommand = async (cmd: string): Promise<string> => {
    const label = `${cmd.slice(0, 60)}${cmd.length > 60 ? "…" : ""}`;
    setProgress(`执行: ${label}`);
    try {
      return await runAndCapture(cmd, {
        onProgress: ({ elapsedMs, idleMs }) => {
          const s = Math.floor(elapsedMs / 1000);
          const idleS = Math.floor(idleMs / 1000);
          setProgress(
            idleS > 5
              ? `执行: ${label} · 已 ${s}s，空闲 ${idleS}s…`
              : `执行: ${label} · 已 ${s}s，输出中…`,
          );
        },
      });
    } catch (e) {
      return `[执行失败: ${e}]`;
    }
  };

  const clearChat = () => {
    agentHistoryRef.current = [];
    setTurns([]);
    historyRef.current = [];
    setError(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法合成中不响应（避免选字时回车被当成发送）
    // 注：WebKit 在 compositionend 后紧跟的 Enter 仍可能是"选字确认"，
    // 额外加 120ms 防抖，只有非合成 + 非刚刚结束合成才触发发送
    if (e.nativeEvent.isComposing) return;
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    if (e.keyCode === 229) return;
    if (Date.now() - lastCompositionEnd.current < 150) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ask();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
    // 普通 Enter / Shift+Enter 让浏览器默认行为（换行）
  };

  return (
    <div
      className="flex h-[320px] shrink-0 flex-col overflow-hidden border-t border-neutral-800 bg-neutral-900"
    >
        <div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-4 py-2">
          <Bot size={16} className="text-blue-400" />
          <span className="text-sm font-semibold text-neutral-100">AI 助手</span>
          <span className="text-[11px] text-neutral-500">⌘J 呼出</span>
          <div className="flex-1" />
          <label
            className="flex cursor-pointer items-center gap-1 text-xs text-neutral-400"
            title="开启后 AI 回答里的命令会被自动执行，结果返给 AI 继续决策"
          >
            <input
              type="checkbox"
              checked={agentMode}
              onChange={(e) => toggleAgent(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span className={agentMode ? "text-amber-400" : ""}>Agent 模式</span>
          </label>
          {providers.length > 0 && (
            <select
              value={activeId ?? ""}
              onChange={(e) => setActive(e.target.value || null)}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-xs text-neutral-200 outline-none"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={onOpenManager}
            className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            <Settings size={11} /> 管理
          </button>
          <button
            onClick={clearChat}
            disabled={turns.length === 0 && !error}
            className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          >
            <Trash2 size={11} /> 清空
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            <X size={14} />
          </button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {turns.length === 0 && !loading && !error && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-neutral-500">
              <div>用自然语言描述你想做的事，AI 会给出要敲的命令。</div>
              <div className="text-neutral-600">例如：</div>
              <div className="font-mono text-neutral-600">
                "查看监听 8080 的进程"<br />
                "nginx access.log 前 10 个 IP"<br />
                "tar 压缩排除 node_modules"
              </div>
              {providers.length === 0 && (
                <button
                  onClick={onOpenManager}
                  className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500"
                >
                  先配置一个 AI 模型
                </button>
              )}
            </div>
          )}
          {turns.map((t, i) => (
            <TurnView
              key={i}
              turn={t}
              loading={loading}
              onContinueAfterAuth={continueAfterAuth}
              onRun={async (cmd) => {
                const r = await sendCommandToActive(cmd, true);
                if (!r.ok) {
                  setFlash(r.reason ?? "执行失败");
                  setTimeout(() => setFlash(null), 2500);
                  return;
                }
                window.dispatchEvent(new CustomEvent("hyper:focus-terminal"));
                setFlash("已执行");
                setTimeout(() => setFlash(null), 1200);
              }}
              onPaste={async (cmd) => {
                const r = await sendCommandToActive(cmd, false);
                if (!r.ok) {
                  setFlash(r.reason ?? "发送失败");
                  setTimeout(() => setFlash(null), 2500);
                  return;
                }
                window.dispatchEvent(new CustomEvent("hyper:focus-terminal"));
                setFlash("已填到终端，按回车执行");
                setTimeout(() => setFlash(null), 1500);
              }}
            />
          ))}
          {loading && (
            <div className="my-2 flex items-center gap-2 text-xs text-neutral-500">
              <Loader2 size={12} className="animate-spin text-blue-400" />
              {progress ?? "思考中…"}
            </div>
          )}
          {error && (
            <div className="mt-3 rounded border border-red-900/50 bg-red-950/40 p-2 text-xs text-red-300">
              <div>{error}</div>
              {errorRetryable && lastAskRef.current && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={retryLast}
                    disabled={loading}
                    className="flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-40"
                  >
                    <RefreshCw size={10} /> 重试
                  </button>
                  {providers
                    .filter((p) => p.id !== activeId)
                    .slice(0, 4)
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => switchProviderAndRetry(p.id)}
                        disabled={loading}
                        className="rounded border border-red-700/60 px-2 py-1 text-xs text-red-200 hover:bg-red-900/40 disabled:opacity-40"
                        title={`切到 ${p.name} (${p.model}) 并重试`}
                      >
                        切到 {p.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-neutral-800 px-3 py-2">
          {attachments.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <div
                  key={i}
                  title={a.localPath}
                  className={cn(
                    "flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs",
                    a.status === "error"
                      ? "border-red-900/60 bg-red-950/40 text-red-300"
                      : a.status === "uploading"
                        ? "border-blue-900/60 bg-blue-950/40 text-blue-300"
                        : a.status === "done"
                          ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-300"
                          : "border-neutral-700 bg-neutral-800 text-neutral-300",
                  )}
                >
                  {a.kind === "dir" ? <Folder size={10} /> : <Paperclip size={10} />}
                  <span className="max-w-40 truncate">
                    {a.name}
                    {a.kind === "dir" ? "/" : ""}
                  </span>
                  {a.status === "uploading" && (
                    <Loader2 size={10} className="animate-spin" />
                  )}
                  {a.status === "done" && <Check size={10} />}
                  {a.status === "error" && (
                    <span title={a.error} className="flex">
                      <AlertTriangle size={10} />
                    </span>
                  )}
                  {!loading && (
                    <button
                      onClick={() => removeAttachment(i)}
                      className="rounded p-0.5 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100"
                      title="移除"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionEnd={() => {
              lastCompositionEnd.current = Date.now();
            }}
            rows={2}
            placeholder={
              attachments.length > 0
                ? "说明一下这些文件要怎么处理… (可留空，AI 会自己决定)"
                : "问 AI... ⌘+回车发送 · Esc 关闭 · 左下可附本地文件"
            }
            className="w-full resize-none rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
            disabled={loading}
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-600">
            <span>
              {activeProvider
                ? `当前模型：${activeProvider.name} (${activeProvider.model})`
                : "未选择模型"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={pickFiles}
                disabled={loading}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40"
                title="附本地文件（会 SFTP 上传到远端 /tmp/ 供 AI 处理）"
              >
                <Paperclip size={12} />
              </button>
              <button
                onClick={pickDir}
                disabled={loading}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40"
                title="附本地文件夹（整棵目录树递归 SFTP 上传到远端 /tmp/ 保留结构）"
              >
                <Folder size={12} />
              </button>
              {loading ? (
                <button
                  onClick={stopAgent}
                  disabled={stopRequestedRef.current}
                  className="flex items-center gap-1 rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-500 disabled:opacity-40"
                  title="中止当前 AI 循环"
                >
                  <Square size={10} /> 停止
                </button>
              ) : (
                <button
                  onClick={ask}
                  disabled={!input.trim() && attachments.length === 0}
                  className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  发送 ⌘↵
                </button>
              )}
            </div>
          </div>
          {flash && (
            <div className="mt-1 text-xs text-emerald-400">{flash}</div>
          )}
        </div>
    </div>
  );
}

function TurnView({
  turn,
  onRun,
  onPaste,
  onContinueAfterAuth,
  loading,
}: {
  turn: Turn;
  onRun: (command: string) => void;
  onPaste: (command: string) => void;
  onContinueAfterAuth: () => void;
  loading: boolean;
}) {
  if (turn.role === "user") {
    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-[80%] rounded-lg rounded-tr-sm bg-blue-600 px-3 py-1.5 text-sm text-white">
          {turn.content}
        </div>
      </div>
    );
  }
  if (turn.role === "exec") {
    const needsPassword = turn.content.startsWith("[🔐 NEEDS_PASSWORD");
    const needsConfirm = turn.content.startsWith("[❓ NEEDS_CONFIRM");
    if (needsPassword || needsConfirm) {
      const Icon = needsPassword ? KeyRound : HelpCircle;
      const title = needsPassword
        ? "🔐 命令需要你输入密码"
        : "❓ 命令需要你确认（y/N）";
      const howto = needsPassword
        ? [
            "1. 点击下方「打开终端」按钮（或直接点上方终端区域）",
            "2. 在终端里输入 sudo / ssh 密码（终端不会显示打字，正常）",
            "3. 回车后，再点「我输好了，继续」让 AI 接着做",
          ]
        : [
            "1. 点击「打开终端」按钮（或点上方终端区域）",
            "2. 输入 y 或 yes 后回车",
            "3. 再点「已确认，继续」让 AI 接着做",
          ];
      return (
        <div className="mb-3 rounded-lg border-2 border-amber-500/70 bg-amber-950/30 p-3 shadow-lg shadow-amber-900/20">
          <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-amber-400">
            <Icon size={11} /> 需要你的操作
          </div>
          {turn.command && (
            <div className="mb-2 rounded bg-black/30 px-2 py-1 font-mono text-xs text-amber-300">
              $ {turn.command}
            </div>
          )}
          <div className="mb-2 text-sm font-medium text-amber-100">{title}</div>
          <ul className="mb-3 space-y-0.5 text-xs leading-relaxed text-amber-200/90">
            {howto.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                window.dispatchEvent(new CustomEvent("hyper:focus-terminal"))
              }
              className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
            >
              打开终端 →
            </button>
            <button
              onClick={onContinueAfterAuth}
              disabled={loading}
              className="rounded border border-amber-600/70 bg-amber-900/30 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-900/60 disabled:opacity-40"
            >
              {needsPassword ? "我输好了，继续" : "已确认，继续"}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="mb-3 rounded border border-emerald-900/60 bg-emerald-950/20 p-2">
        <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-emerald-500">
          <Terminal size={10} /> 自动执行
        </div>
        {turn.command && (
          <div className="mb-1 font-mono text-xs text-emerald-300">
            $ {turn.command}
          </div>
        )}
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-neutral-950 p-2 font-mono text-xs text-neutral-300">
          {turn.content || "(无输出)"}
        </pre>
      </div>
    );
  }
  // 纯工具调用占位符（AI 这轮只调了工具没说话）
  const toolPlaceholder = turn.content.match(/^__TOOL_CALL_PLACEHOLDER__:(\d+)$/);
  if (toolPlaceholder) {
    const n = Number(toolPlaceholder[1]);
    return (
      <div className="mb-4">
        <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-neutral-500">
          <Sparkles size={10} /> 助手
        </div>
        <div className="inline-flex items-center gap-1.5 rounded border border-blue-900/40 bg-blue-950/20 px-2 py-1 text-xs text-blue-300">
          <Wrench size={11} />
          调用 {n} 个工具
        </div>
      </div>
    );
  }
  const blocks = extractCodeBlocks(turn.content);
  const segments = splitByCodeBlocks(turn.content);
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-neutral-500">
        <Sparkles size={10} /> 助手
      </div>
      <div className="space-y-2">
        {segments.map((seg, i) =>
          seg.kind === "text" ? (
            <div
              key={i}
              className="whitespace-pre-wrap text-sm text-neutral-200"
            >
              {seg.text}
            </div>
          ) : (
            <CodeBlock
              key={i}
              lang={seg.lang}
              code={seg.code}
              onRun={() => onRun(seg.code)}
              onPaste={() => onPaste(seg.code)}
              isDangerous={isDangerousCmd(seg.code)}
            />
          ),
        )}
        {segments.every((s) => s.kind === "text") && blocks.length === 0 && (
          <div className="text-[11px] text-neutral-600">
            （本次回答没有可执行的命令块）
          </div>
        )}
      </div>
    </div>
  );
}

type Segment =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string; code: string };

function splitByCodeBlocks(markdown: string): Segment[] {
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

function isRetryable(e: unknown): boolean {
  const s = String(e);
  // 上游过载 / 限流 / 网关瞬时错误：Anthropic 529、429、502/503/504、fetch network
  if (/\b(429|529|502|503|504)\b/.test(s)) return true;
  if (/overloaded_error|rate[_ ]?limit|timeout|network|ECONN/i.test(s)) return true;
  return false;
}

function friendlyError(e: unknown): string {
  const raw = String(e);
  if (/529|overloaded_error/i.test(raw))
    return "模型服务当前过载（上游 529），已自动重试仍失败。稍后再试，或换一个 Provider。";
  if (/\b429\b|rate[_ ]?limit/i.test(raw))
    return "触发了 Provider 速率限制（429）。稍等一会再发。";
  if (/\b401\b|invalid[_ ]?api[_ ]?key/i.test(raw))
    return "API Key 无效或已过期，请在「管理」里更新。";
  if (/network|ECONN|fetch/i.test(raw))
    return `网络错误：${raw}`;
  return raw;
}

function isDangerousCmd(s: string): boolean {
  // 检测常见的破坏性命令：rm -rf / dd if= / mkfs / shutdown / reboot
  if (/\brm\s+-[rRf]+\b.*\s\//.test(s)) return true;
  if (/\bdd\s+if=/.test(s)) return true;
  if (/\bmkfs\./.test(s)) return true;
  if (/\b(shutdown|reboot|halt|poweroff)\b/.test(s)) return true;
  if (/>\s*\/dev\/sd[a-z]/.test(s)) return true;
  return false;
}

function CodeBlock({
  lang,
  code,
  onRun,
  onPaste,
  isDangerous,
}: {
  lang: string;
  code: string;
  onRun: () => void;
  onPaste: () => void;
  isDangerous: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const doRun = () => {
    if (isDangerous) {
      setConfirming(true);
      return;
    }
    onRun();
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded border",
        isDangerous ? "border-red-700" : "border-neutral-700",
      )}
    >
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px]">
        <span className="text-neutral-500">{lang || "shell"}</span>
        <div className="flex gap-1">
          {isDangerous && (
            <span className="flex items-center gap-0.5 rounded bg-red-900/40 px-1.5 py-0.5 text-[9px] text-red-300">
              <AlertTriangle size={10} /> 危险
            </span>
          )}
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            {copied ? <Check size={10} /> : <ClipboardCopy size={10} />}
            {copied ? "已复制" : "复制"}
          </button>
          <button
            onClick={onPaste}
            className="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            title="只填入终端，不敲回车（可以先改一下再执行）"
          >
            填入
          </button>
          <button
            onClick={doRun}
            className={cn(
              "flex items-center gap-0.5 rounded px-2 py-0.5 text-[11px] text-white",
              isDangerous
                ? "bg-red-600 hover:bg-red-500"
                : "bg-blue-600 hover:bg-blue-500",
            )}
            title="直接在终端里执行（带回车）"
          >
            <Play size={10} /> 执行
          </button>
        </div>
      </div>
      <pre className="overflow-auto bg-neutral-950 p-2 font-mono text-[12px] text-neutral-200">
        {code}
      </pre>
      {confirming && (
        <div className="border-t border-red-700 bg-red-950/40 px-2 py-1.5 text-xs text-red-200">
          ⚠ 这条命令可能有破坏性，确认执行？
          <button
            onClick={() => {
              setConfirming(false);
              onRun();
            }}
            className="ml-2 rounded bg-red-600 px-2 py-0.5 text-[11px] text-white hover:bg-red-500"
          >
            确认执行
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="ml-1 rounded border border-red-700 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-900/40"
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
}
