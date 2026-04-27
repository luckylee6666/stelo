import { useState } from "react";
import { useGroupStore } from "../stores/groups";
import { cn } from "../lib/utils";

type Props = {
  value: string | undefined;
  onChange: (groupId: string | undefined) => void;
};

export function GroupSelect({ value, onChange }: Props) {
  const groups = useGroupStore((s) => s.groups);
  const addGroup = useGroupStore((s) => s.addGroup);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const confirmCreate = () => {
    if (!newName.trim()) return;
    const id = addGroup(newName.trim());
    onChange(id);
    setCreating(false);
    setNewName("");
  };

  if (creating) {
    return (
      <div className="flex gap-2">
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmCreate();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setCreating(false);
              setNewName("");
            }
          }}
          placeholder="新分组名称"
          className="w-full rounded border border-blue-600 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none"
        />
        <button
          type="button"
          onClick={confirmCreate}
          disabled={!newName.trim()}
          className="shrink-0 rounded bg-blue-600 px-3 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
        >
          ✓
        </button>
        <button
          type="button"
          onClick={() => {
            setCreating(false);
            setNewName("");
          }}
          className="shrink-0 rounded border border-neutral-700 px-2 text-xs text-neutral-400 hover:bg-neutral-800"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <select
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === "__new__") {
            setCreating(true);
          } else {
            onChange(e.target.value || undefined);
          }
        }}
        className={cn(
          "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500",
        )}
      >
        <option value="">未分组</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
        <option value="__new__">+ 新建分组…</option>
      </select>
    </div>
  );
}
