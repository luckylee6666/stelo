import { useEffect, useRef, useState } from "react";
import { useSnippetStore, type Snippet } from "../stores/snippets";
import { sendSnippetToActive } from "../lib/snippets";
import { ConfirmDialog } from "./ConfirmDialog";
import { useDialogEscape } from "../lib/useDialogEscape";

type Props = {
  onClose: () => void;
};

export function SnippetManagerDialog({ onClose }: Props) {
  const snippetsRaw = useSnippetStore((s) => s.snippets);
  const addSnippet = useSnippetStore((s) => s.addSnippet);
  const updateSnippet = useSnippetStore((s) => s.updateSnippet);
  const removeSnippet = useSnippetStore((s) => s.removeSnippet);
  const snippets = [...snippetsRaw].sort(
    (a, b) =>
      b.useCount - a.useCount ||
      b.lastUsedAt - a.lastUsedAt ||
      a.name.localeCompare(b.name),
  );

  const [editing, setEditing] = useState<Snippet | null | "new">(null);
  const [pendingDelete, setPendingDelete] = useState<Snippet | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useDialogEscape(onClose, !editing && !pendingDelete);

  const runSnippet = async (cmd: string, id: string) => {
    const r = await sendSnippetToActive(cmd, id);
    if (!r.ok) {
      setToast(`发送失败：${r.reason}`);
      setTimeout(() => setToast(null), 2500);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[560px] w-[640px] flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              快捷指令
            </h2>
            <p className="text-xs text-neutral-500">
              点击指令发送到当前会话；⌘K 可从任何地方快速呼出
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {snippets.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-500">
              <span>还没有快捷指令</span>
              <button
                onClick={() => setEditing("new")}
                className="mt-2 rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500"
              >
                + 新建指令
              </button>
            </div>
          )}
          {snippets.length > 0 && (
            <div className="divide-y divide-neutral-800">
              {snippets.map((s) => (
                <div
                  key={s.id}
                  className="group flex items-center gap-3 px-5 py-2.5 hover:bg-neutral-800/30"
                >
                  <span className="text-lg">⚡</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-neutral-100">
                      {s.name}
                    </div>
                    <div className="truncate font-mono text-xs text-neutral-500">
                      {s.command}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => runSnippet(s.command, s.id)}
                      className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
                      title="发送到当前会话"
                    >
                      发送
                    </button>
                    {s.useCount > 0 && (
                      <span className="ml-1 self-center text-[11px] text-neutral-500">
                        {s.useCount} 次
                      </span>
                    )}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={() => setEditing(s)}
                        className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setPendingDelete(s)}
                        className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-red-900/60 hover:text-red-200"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {snippets.length > 0 && (
          <div className="shrink-0 border-t border-neutral-800 px-5 py-3">
            <button
              onClick={() => setEditing("new")}
              className="rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500"
            >
              + 新建指令
            </button>
          </div>
        )}

        {toast && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-red-600 px-3 py-1.5 text-xs text-white shadow-lg">
            {toast}
          </div>
        )}
      </div>

      {editing !== null && (
        <SnippetForm
          initial={editing === "new" ? null : editing}
          onSubmit={(name, command) => {
            if (editing === "new") addSnippet(name, command);
            else updateSnippet(editing.id, { name, command });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="删除指令"
          message={`确认删除"${pendingDelete.name}"？`}
          confirmText="删除"
          danger
          onConfirm={() => {
            removeSnippet(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function SnippetForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: Snippet | null;
  onSubmit: (name: string, command: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 40);
  }, []);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim() || !command.trim()) {
      setError("名称和命令都必填");
      return;
    }
    onSubmit(name.trim(), command);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
      >
        <h3 className="mb-3 text-sm font-semibold text-neutral-100">
          {initial ? "编辑指令" : "新建指令"}
        </h3>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
              名称
            </span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：查看 nginx 日志"
              className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
              命令
            </span>
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="tail -f /var/log/nginx/access.log"
              rows={4}
              className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </label>
          <p className="text-xs text-neutral-500">
            发送时会自动加回车执行。支持多行命令（每行单独执行）。
          </p>
        </div>

        {error && (
          <div className="mt-3 rounded border border-red-900/50 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
