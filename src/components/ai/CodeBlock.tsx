import { useState } from "react";
import { AlertTriangle, Check, ClipboardCopy, Play } from "lucide-react";
import { cn } from "../../lib/utils";

type Props = {
  lang: string;
  code: string;
  onRun: () => void;
  onPaste: () => void;
  isDangerous: boolean;
};

/**
 * AI 回复里的 ``` 代码块视图：复制 / 填入终端 / 执行（破坏性命令需二次确认）
 */
export function CodeBlock({ lang, code, onRun, onPaste, isDangerous }: Props) {
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
