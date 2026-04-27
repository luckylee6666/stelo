import { useEffect, useRef } from "react";
import { ShieldAlert, AlertTriangle, Info } from "lucide-react";
import { useDialogStore } from "../lib/dialog";

/**
 * 全局 confirm 对话框——Promise-based，替换裸 window.confirm。
 * 在 App 根挂一份；任何代码用 `await confirm(opts)` 拿用户选择。
 *
 * 视觉：danger（红） / warn（琥珀） / info（蓝）三种语调；
 *      支持 preview 显示长文本（粘贴预览等）；ESC 取消，Enter 确认。
 */
export function DialogHost() {
  const current = useDialogStore((s) => s.current);
  const settle = useDialogStore((s) => s._settle);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!current) return;
    // 焦点落到确认按钮（不是默认按钮，避免误回车删除）
    const t = setTimeout(() => confirmBtnRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        settle(false);
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl+Enter 才确认，单独回车不触发，进一步降低误触
        e.preventDefault();
        settle(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [current, settle]);

  if (!current) return null;
  const { opts } = current;
  const tone = opts.danger ? "danger" : opts.warn ? "warn" : "info";

  const Icon = tone === "danger" ? ShieldAlert : tone === "warn" ? AlertTriangle : Info;
  const accent =
    tone === "danger"
      ? "border-red-600/70 shadow-red-900/30"
      : tone === "warn"
        ? "border-amber-600/70 shadow-amber-900/30"
        : "border-neutral-700 shadow-black/40";
  const iconColor =
    tone === "danger" ? "text-red-400" : tone === "warn" ? "text-amber-400" : "text-blue-400";
  const confirmBtnCls =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-500 focus:ring-red-400"
      : tone === "warn"
        ? "bg-amber-600 hover:bg-amber-500 focus:ring-amber-400"
        : "bg-blue-600 hover:bg-blue-500 focus:ring-blue-400";

  return (
    <div
      // 进入动画：fade + scale
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={() => settle(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-[440px] max-w-[90vw] rounded-lg border-2 bg-neutral-900 p-5 shadow-2xl animate-in zoom-in-95 fade-in duration-150 ${accent}`}
      >
        <div className="mb-3 flex items-center gap-2">
          <Icon size={18} className={iconColor} />
          <h2 className="text-sm font-semibold text-neutral-100">{opts.title}</h2>
        </div>

        <p className="whitespace-pre-line text-xs leading-relaxed text-neutral-300">
          {opts.message}
        </p>

        {opts.preview && (
          <pre className="mt-3 max-h-40 overflow-auto rounded border border-neutral-800 bg-neutral-950 p-2 text-[11px] leading-relaxed text-neutral-400">
            {opts.preview}
          </pre>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(false)}
            className="rounded border border-neutral-700 px-3.5 py-1.5 text-sm text-neutral-300 transition-colors duration-150 hover:bg-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-500"
          >
            {opts.cancelText ?? "取消"}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => settle(true)}
            className={`rounded px-4 py-1.5 text-sm font-medium text-white transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-900 ${confirmBtnCls}`}
          >
            {opts.confirmText ?? "确认"}
          </button>
        </div>

        <div className="mt-2 text-right text-[10px] text-neutral-600">
          ESC 取消 · ⌘Enter 确认
        </div>
      </div>
    </div>
  );
}
