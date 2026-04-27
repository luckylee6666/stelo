import { useEffect } from "react";
import { Keyboard, X } from "lucide-react";

type Props = {
  onClose: () => void;
};

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

const SECTIONS: { title: string; items: { keys: string[]; desc: string }[] }[] = [
  {
    title: "全局",
    items: [
      { keys: [MOD, "K"], desc: "命令面板（搜会话 / 历史 / 动作）" },
      { keys: [MOD, "J"], desc: "AI 助手抽屉" },
      { keys: [MOD, "T"], desc: "新建会话" },
      { keys: [MOD, "W"], desc: "关闭当前会话" },
      { keys: [MOD, "F"], desc: "终端内搜索" },
      { keys: [MOD, "?"], desc: "本快捷键速查" },
      { keys: [MOD, "1"], desc: "切到第 1 个 tab" },
      { keys: [MOD, "2..9"], desc: "切到第 N 个 tab" },
      { keys: [MOD, "+"], desc: "增大终端字号" },
      { keys: [MOD, "-"], desc: "减小终端字号" },
      { keys: [MOD, "0"], desc: "重置终端字号" },
    ],
  },
  {
    title: "对话框",
    items: [
      { keys: ["Esc"], desc: "取消 / 关闭" },
      { keys: [MOD, "Enter"], desc: "确认主操作（防误触）" },
    ],
  },
  {
    title: "终端",
    items: [
      { keys: [MOD, "C"], desc: "复制选中" },
      { keys: [MOD, "V"], desc: "粘贴（多行需确认）" },
      { keys: ["Up", "Down"], desc: "命令历史滚动（远端 shell）" },
    ],
  },
  {
    title: "AI Agent",
    items: [
      { keys: ["Enter"], desc: "发送消息" },
      { keys: ["Shift", "Enter"], desc: "换行" },
      { keys: [MOD, "Enter"], desc: "执行 AI 给的命令（确认后）" },
    ],
  },
];

export function ShortcutsDialog({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[640px] max-w-[90vw] flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl animate-in zoom-in-95 fade-in duration-150"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-neutral-100">快捷键</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            {SECTIONS.map((sec) => (
              <div key={sec.title}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {sec.title}
                </div>
                <div className="space-y-1.5">
                  {sec.items.map((it, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-neutral-300">{it.desc}</span>
                      <span className="flex shrink-0 gap-1">
                        {it.keys.map((k, j) => (
                          <kbd
                            key={j}
                            className="inline-flex min-w-[24px] items-center justify-center rounded border border-neutral-700 bg-neutral-800/70 px-1.5 py-0.5 font-mono text-[11px] text-neutral-300 shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)]"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-neutral-800 px-5 py-2.5 text-[11px] text-neutral-500">
          按 <kbd className="rounded bg-neutral-800 px-1 font-mono text-neutral-400">Esc</kbd> 关闭
        </div>
      </div>
    </div>
  );
}
