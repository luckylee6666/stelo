import { useState } from "react";
import { useGroupStore, type Group } from "../stores/groups";
import { useSessionStore } from "../stores/sessions";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  onClose: () => void;
};

export function GroupManagerDialog({ onClose }: Props) {
  const groups = useGroupStore((s) => s.groups);
  const addGroup = useGroupStore((s) => s.addGroup);
  const updateGroup = useGroupStore((s) => s.updateGroup);
  const removeGroup = useGroupStore((s) => s.removeGroup);
  const sessions = useSessionStore((s) => s.sessions);
  const updateMeta = useSessionStore((s) => s.updateMeta);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);

  const countInGroup = (gid: string) =>
    sessions.filter((s) => s.groupId === gid).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[460px] w-[480px] flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              分组管理
            </h2>
            <p className="text-xs text-neutral-500">
              新建 / 重命名 / 删除会话分组
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
          {groups.length === 0 && !adding && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-500">
              <span>还没有分组</span>
              <button
                onClick={() => setAdding(true)}
                className="mt-2 rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500"
              >
                + 新建分组
              </button>
            </div>
          )}

          {groups.length > 0 && (
            <div className="divide-y divide-neutral-800">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="group flex items-center gap-3 px-5 py-2.5 hover:bg-neutral-800/30"
                >
                  <span className="text-lg">📁</span>
                  <div className="min-w-0 flex-1">
                    {editingId === g.id ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            if (editingName.trim()) {
                              updateGroup(g.id, { name: editingName.trim() });
                            }
                            setEditingId(null);
                          } else if (e.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                        onBlur={() => {
                          if (editingName.trim() && editingName.trim() !== g.name) {
                            updateGroup(g.id, { name: editingName.trim() });
                          }
                          setEditingId(null);
                        }}
                        className="w-full rounded border border-blue-600 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          setEditingId(g.id);
                          setEditingName(g.name);
                        }}
                        className="truncate text-left text-sm text-neutral-100 hover:underline"
                      >
                        {g.name}
                      </button>
                    )}
                    <div className="truncate text-xs text-neutral-500">
                      {countInGroup(g.id)} 个会话
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => {
                        setEditingId(g.id);
                        setEditingName(g.name);
                      }}
                      className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
                    >
                      重命名
                    </button>
                    <button
                      onClick={() => setPendingDelete(g)}
                      className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-red-900/60 hover:text-red-200"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {adding && (
            <div className="px-5 py-3">
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (newName.trim()) {
                        addGroup(newName.trim());
                        setNewName("");
                        setAdding(false);
                      }
                    } else if (e.key === "Escape") {
                      setAdding(false);
                      setNewName("");
                    }
                  }}
                  placeholder="分组名称"
                  className="w-full rounded border border-blue-600 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none"
                />
                <button
                  onClick={() => {
                    if (newName.trim()) {
                      addGroup(newName.trim());
                      setNewName("");
                      setAdding(false);
                    }
                  }}
                  disabled={!newName.trim()}
                  className="shrink-0 rounded bg-blue-600 px-3 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  ✓
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setNewName("");
                  }}
                  className="shrink-0 rounded border border-neutral-700 px-2 text-xs text-neutral-400 hover:bg-neutral-800"
                >
                  ×
                </button>
              </div>
            </div>
          )}
        </div>

        {groups.length > 0 && !adding && (
          <div className="shrink-0 border-t border-neutral-800 px-5 py-3">
            <button
              onClick={() => setAdding(true)}
              className="rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500"
            >
              + 新建分组
            </button>
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="删除分组"
          message={`确认删除分组"${pendingDelete.name}"？组内 ${countInGroup(pendingDelete.id)} 个会话会移动到"未分组"。`}
          confirmText="删除"
          danger
          onConfirm={() => {
            const gid = pendingDelete.id;
            for (const s of sessions) {
              if (s.groupId === gid) updateMeta(s.id, { groupId: undefined });
            }
            removeGroup(gid);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
