import { useSessionStore, colorHex } from "../stores/sessions";
import { cn } from "../lib/utils";
import { X, Radio } from "lucide-react";

export function TabBar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const setActive = useSessionStore((s) => s.setActive);
  const disconnectSession = useSessionStore((s) => s.disconnectSession);

  const visible = sessions.filter(
    (s) => s.backendId || s.status === "connecting" || s.kind === "local",
  );
  // 始终渲染一个 h-9 的条带：给 macOS Overlay 标题栏提供 drag region。
  // 即使没有 tab，用户也能拖这一条挪窗口。
  if (visible.length === 0) {
    return (
      <div
        data-tauri-drag-region
        className="h-9 border-b border-neutral-800 bg-neutral-900"
      />
    );
  }

  return (
    <div
      data-tauri-drag-region
      className="flex h-9 items-center overflow-x-auto border-b border-neutral-800 bg-neutral-900"
    >
      {visible.map((s) => {
        const color = colorHex(s.colorLabel);
        const active = activeId === s.id;
        return (
          <div
            key={s.id}
            onClick={() => setActive(s.id)}
            className={cn(
              "group relative flex h-full cursor-pointer select-none items-center gap-2 border-r border-neutral-800 px-3 text-sm transition-colors",
              active
                ? "bg-linear-to-b from-neutral-800/90 to-neutral-900 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200",
            )}
          >
            {s.colorLabel && (
              <span
                className="absolute left-0 top-0 h-0.5 w-full"
                style={{ background: color }}
              />
            )}
            {/* 激活指示条（没有颜色标签才显示，避免和 colorLabel 顶部条撞色） */}
            {active && !s.colorLabel && (
              <span className="absolute left-0 top-0 h-0.5 w-full bg-linear-to-r from-blue-500 to-blue-600" />
            )}
            {active && (
              <span className="absolute inset-x-0 bottom-0 h-px bg-neutral-900" />
            )}
            <span className="max-w-40 truncate">{s.name}</span>
            {s.syncInput && (
              <span
                className="shrink-0 rounded bg-amber-500/25 p-0.5 text-amber-300"
                title="同步输入"
              >
                <Radio size={10} />
              </span>
            )}
            <span
              onClick={(e) => {
                e.stopPropagation();
                disconnectSession(s.id);
              }}
              title={s.kind === "ssh" ? "关闭连接（保留在侧栏）" : "关闭"}
              className="rounded p-0.5 text-neutral-500 opacity-0 hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100"
            >
              <X size={13} />
            </span>
          </div>
        );
      })}
      {/* 右侧可拖占位：保证即使 tab 铺满也有地方拖窗口 */}
      <div
        data-tauri-drag-region
        className="h-full min-w-8 flex-1"
      />
    </div>
  );
}
