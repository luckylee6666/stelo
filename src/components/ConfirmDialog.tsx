import { useEffect, useRef } from "react";
import { ShieldAlert, AlertTriangle, Info } from "lucide-react";

type Props = {
  title: string;
  message: string;
  confirmText?: string;
  /** 红色 danger 强调（删除等） */
  danger?: boolean;
  /** 琥珀色 warn 强调（介于 info 和 danger 之间） */
  warn?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 受控对话框（旧 API），保留给现存调用点。新代码请用 `import { confirm } from "@/lib/dialog"`。
 * 视觉跟 DialogHost 保持一致：进入动画 / danger/warn/info 三种语调 / ESC + ⌘Enter 键位。
 */
export function ConfirmDialog({
  title,
  message,
  confirmText = "确认",
  danger,
  warn,
  onConfirm,
  onCancel,
}: Props) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const t = setTimeout(() => confirmBtnRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel, onConfirm]);

  const tone = danger ? "danger" : warn ? "warn" : "info";
  const Icon = tone === "danger" ? ShieldAlert : tone === "warn" ? AlertTriangle : Info;
  const accent =
    tone === "danger"
      ? "border-red-600/70 shadow-red-900/30"
      : tone === "warn"
        ? "border-amber-600/70 shadow-amber-900/30"
        : "border-neutral-700 shadow-black/40";
  const iconColor =
    tone === "danger" ? "text-red-400" : tone === "warn" ? "text-amber-400" : "text-blue-400";
  const confirmCls =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-500 focus:ring-red-400"
      : tone === "warn"
        ? "bg-amber-600 hover:bg-amber-500 focus:ring-amber-400"
        : "bg-blue-600 hover:bg-blue-500 focus:ring-blue-400";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-[400px] max-w-[90vw] rounded-lg border-2 bg-neutral-900 p-5 shadow-2xl animate-in zoom-in-95 fade-in duration-150 ${accent}`}
      >
        <div className="mb-3 flex items-center gap-2">
          <Icon size={18} className={iconColor} />
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
        </div>
        <p className="whitespace-pre-line text-xs leading-relaxed text-neutral-300">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-neutral-700 px-3.5 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-500"
          >
            取消
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={`rounded px-4 py-1.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-900 ${confirmCls}`}
          >
            {confirmText}
          </button>
        </div>
        <div className="mt-2 text-right text-[10px] text-neutral-600">
          ESC 取消 · ⌘Enter 确认
        </div>
      </div>
    </div>
  );
}
