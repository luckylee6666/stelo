import { useEffect, useMemo, useRef, useState } from "react";
import { useSnippetStore } from "../stores/snippets";
import { useHistoryStore } from "../stores/history";
import { useSessionStore } from "../stores/sessions";
import { sendSnippetToActive } from "../lib/snippets";
import { cn } from "../lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Row =
  | {
      kind: "snippet";
      id: string;
      name: string;
      command: string;
      useCount: number;
      lastUsedAt: number;
    }
  | {
      kind: "history";
      command: string;
      count: number;
      lastAt: number;
    }
  | {
      kind: "session";
      id: string;
      name: string;
      target: string;
      isActive: boolean;
    }
  | {
      kind: "action";
      id: string;
      name: string;
      desc: string;
      run: () => void;
    };

const ACTIONS: Array<{ id: string; name: string; desc: string; event: string }> = [
  { id: "new-session", name: "新建会话", desc: "弹出新会话对话框", event: "hyper:new-session" },
  { id: "open-ai", name: "打开 AI 助手", desc: "⌘J", event: "hyper:open-ai" },
  { id: "open-ai-mgr", name: "AI 模型管理", desc: "管理 API key / Provider", event: "hyper:open-ai-mgr" },
  { id: "open-shortcuts", name: "快捷键速查", desc: "⌘?", event: "hyper:open-shortcuts" },
  { id: "terminal-find", name: "终端内搜索", desc: "⌘F", event: "hyper:terminal-find" },
];

export function CommandPalette({ open, onClose }: Props) {
  const snippets = useSnippetStore((s) => s.snippets);
  const history = useHistoryStore((s) => s.items);
  const removeHistory = useHistoryStore((s) => s.remove);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setFlash(null);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const setActive = useSessionStore((s) => s.setActive);

  const allRows = useMemo<Row[]>(() => {
    // 会话排前面（最常用切换）
    const sessionRows: Row[] = sessions.map((s) => ({
      kind: "session",
      id: s.id,
      name: s.name,
      target:
        s.kind === "ssh"
          ? `${s.user}@${s.host}${s.port && s.port !== 22 ? `:${s.port}` : ""}`
          : "本地终端",
      isActive: s.id === activeId,
    }));
    const actionRows: Row[] = ACTIONS.map((a) => ({
      kind: "action",
      id: a.id,
      name: a.name,
      desc: a.desc,
      run: () => window.dispatchEvent(new CustomEvent(a.event)),
    }));
    const snippetCmds = new Set(snippets.map((s) => s.command));
    const snippetRows: Row[] = snippets
      .slice()
      .sort(
        (a, b) =>
          b.useCount - a.useCount ||
          b.lastUsedAt - a.lastUsedAt ||
          a.name.localeCompare(b.name),
      )
      .map((s) => ({
        kind: "snippet",
        id: s.id,
        name: s.name,
        command: s.command,
        useCount: s.useCount,
        lastUsedAt: s.lastUsedAt,
      }));
    const historyRows: Row[] = history
      .filter((h) => !snippetCmds.has(h.command))
      .slice()
      .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
      .map((h) => ({
        kind: "history",
        command: h.command,
        count: h.count,
        lastAt: h.lastAt,
      }));
    return [...sessionRows, ...actionRows, ...snippetRows, ...historyRows];
  }, [sessions, activeId, snippets, history]);

  const results = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => {
      let hay = "";
      if (r.kind === "snippet") hay = `${r.name} ${r.command}`;
      else if (r.kind === "history") hay = r.command;
      else if (r.kind === "session") hay = `${r.name} ${r.target}`;
      else if (r.kind === "action") hay = `${r.name} ${r.desc}`;
      return hay.toLowerCase().includes(q);
    });
  }, [allRows, query]);

  useEffect(() => {
    if (index >= results.length) setIndex(Math.max(0, results.length - 1));
  }, [results, index]);

  if (!open) return null;

  const run = async (row: Row) => {
    if (row.kind === "session") {
      setActive(row.id);
      onClose();
      return;
    }
    if (row.kind === "action") {
      row.run();
      onClose();
      return;
    }
    const r = await sendSnippetToActive(
      row.command,
      row.kind === "snippet" ? row.id : undefined,
    );
    if (!r.ok) {
      setFlash(r.reason ?? "发送失败");
      setTimeout(() => setFlash(null), 2500);
    } else {
      onClose();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[index];
      if (hit) run(hit);
    } else if (e.key === "Backspace" && e.shiftKey) {
      // Shift+Backspace：从历史里移除选中项
      const hit = results[index];
      if (hit && hit.kind === "history") {
        e.preventDefault();
        removeHistory(hit.command);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[620px] flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="搜索会话 / 动作 / 快捷指令 / 命令历史（↵ 执行，Esc 关闭，Shift+⌫ 从历史删除）"
          className="h-11 border-b border-neutral-800 bg-transparent px-4 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
        />
        <div className="max-h-[55vh] overflow-auto py-1">
          {results.length === 0 && (
            <div className="py-8 text-center text-xs text-neutral-500">
              {allRows.length === 0
                ? "没有快捷指令，也还没有命令历史。开始用终端 / 在侧栏 ⚡ 新建一条"
                : "无匹配结果"}
            </div>
          )}
          {results.map((r, i) => {
            const key =
              r.kind === "snippet"
                ? `s-${r.id}`
                : r.kind === "history"
                  ? `h-${r.command}`
                  : r.kind === "session"
                    ? `t-${r.id}`
                    : `a-${r.id}`;
            const icon =
              r.kind === "session"
                ? r.isActive ? "●" : "○"
                : r.kind === "action"
                  ? "▶"
                  : r.kind === "snippet"
                    ? "⚡"
                    : "⏱";
            const primary =
              r.kind === "session"
                ? r.name
                : r.kind === "action"
                  ? r.name
                  : r.kind === "snippet"
                    ? r.name
                    : r.command;
            const secondary =
              r.kind === "session"
                ? r.target
                : r.kind === "action"
                  ? r.desc
                  : r.kind === "snippet"
                    ? r.command
                    : "历史记录";
            const meta =
              r.kind === "session"
                ? r.isActive ? "当前" : "切到此 tab"
                : r.kind === "action"
                  ? "动作"
                  : r.kind === "snippet"
                    ? r.useCount > 0 ? `用过 ${r.useCount} 次` : "未用过"
                    : `${r.count} 次`;
            return (
              <button
                key={key}
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(r)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2 text-left text-sm",
                  i === index
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-300 hover:bg-neutral-800/60",
                )}
              >
                <span className={cn(
                  "shrink-0 text-base",
                  r.kind === "session" && r.isActive ? "text-emerald-400" : "",
                  r.kind === "action" ? "text-blue-400" : "",
                )}>
                  {icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{primary}</div>
                  <div className="truncate font-mono text-xs text-neutral-500">
                    {secondary}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-neutral-500">{meta}</span>
                {i === index && (
                  <span className="shrink-0 text-[11px] text-neutral-500">↵</span>
                )}
              </button>
            );
          })}
        </div>
        {flash && (
          <div className="border-t border-neutral-800 bg-red-950/50 px-4 py-1.5 text-xs text-red-300">
            {flash}
          </div>
        )}
      </div>
    </div>
  );
}
