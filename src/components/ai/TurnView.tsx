import { Sparkles, Terminal, KeyRound, HelpCircle, Wrench } from "lucide-react";
import { extractCodeBlocks } from "../../lib/ai";
import type { Turn } from "./types";
import { isDangerousCmd, splitByCodeBlocks } from "./utils";
import { CodeBlock } from "./CodeBlock";

type Props = {
  turn: Turn;
  onRun: (command: string) => void;
  onPaste: (command: string) => void;
  onContinueAfterAuth: () => void;
  loading: boolean;
};

/** 渲染一轮对话（user / assistant / exec）。三种 role 三种气泡布局。 */
export function TurnView({
  turn,
  onRun,
  onPaste,
  onContinueAfterAuth,
  loading,
}: Props) {
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
