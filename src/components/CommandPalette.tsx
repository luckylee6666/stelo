import { useEffect, useMemo, useRef, useState } from "react";
import { useSnippetStore } from "../stores/snippets";
import { useHistoryStore } from "../stores/history";
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
    };

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

  const allRows = useMemo<Row[]>(() => {
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
    return [...snippetRows, ...historyRows];
  }, [snippets, history]);

  const results = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => {
      const hay =
        r.kind === "snippet"
          ? `${r.name} ${r.command}`
          : r.command;
      return hay.toLowerCase().includes(q);
    });
  }, [allRows, query]);

  useEffect(() => {
    if (index >= results.length) setIndex(Math.max(0, results.length - 1));
  }, [results, index]);

  if (!open) return null;

  const run = async (row: Row) => {
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
          placeholder="搜索快捷指令 / 命令历史（↵ 发送，Esc 关闭，Shift+⌫ 从历史删除）"
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
          {results.map((r, i) => (
            <button
              key={r.kind === "snippet" ? `s-${r.id}` : `h-${r.command}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(r)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2 text-left text-sm",
                i === index
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-300 hover:bg-neutral-800/60",
              )}
            >
              <span className="shrink-0 text-base">
                {r.kind === "snippet" ? "⚡" : "⏱"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  {r.kind === "snippet" ? r.name : r.command}
                </div>
                <div className="truncate font-mono text-xs text-neutral-500">
                  {r.kind === "snippet" ? r.command : "历史记录"}
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-neutral-500">
                {r.kind === "snippet"
                  ? r.useCount > 0
                    ? `用过 ${r.useCount} 次`
                    : "未用过"
                  : `${r.count} 次`}
              </span>
              {i === index && (
                <span className="shrink-0 text-[11px] text-neutral-500">
                  ↵
                </span>
              )}
            </button>
          ))}
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
