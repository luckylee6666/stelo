import { useEffect, useMemo, useState } from "react";
import { useSessionStore, colorHex, type Session } from "../stores/sessions";
import { useGroupStore, type Group } from "../stores/groups";
import { cn } from "../lib/utils";
import { LS, lsGetJson, lsSetJson } from "../lib/storage";
import { NewSessionDialog } from "./NewSessionDialog";
import { ThemeMenu } from "./ThemeMenu";
import { LangMenu } from "./LangMenu";
import { autoConnect } from "../lib/autoConnect";
import { EditSessionDialog } from "./EditSessionDialog";
import { KeyManagerDialog } from "./KeyManagerDialog";
import { GroupManagerDialog } from "./GroupManagerDialog";
import { SnippetManagerDialog } from "./SnippetManagerDialog";
import { AiManagerDialog } from "./AiManagerDialog";
import { KnownHostsDialog } from "./KnownHostsDialog";
import { ConfigBackupDialog } from "./ConfigBackupDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { useT } from "../i18n";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Pencil,
  X,
  Radio as RadioIcon,
  KeyRound,
  FolderOpen,
  Zap,
  Sparkles,
  Search,
  ShieldCheck,
  Database,
} from "lucide-react";

const Radio = RadioIcon;

function loadCollapsed(): Set<string> {
  const list = lsGetJson<string[]>(LS.groupsCollapsed, []);
  return new Set(Array.isArray(list) ? list : []);
}

function saveCollapsed(s: Set<string>) {
  lsSetJson(LS.groupsCollapsed, [...s]);
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const setActive = useSessionStore((s) => s.setActive);
  const closeSession = useSessionStore((s) => s.closeSession);
  const updateMeta = useSessionStore((s) => s.updateMeta);
  const groups = useGroupStore((s) => s.groups);
  const updateGroup = useGroupStore((s) => s.updateGroup);
  const removeGroup = useGroupStore((s) => s.removeGroup);
  const t = useT();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [keyMgrOpen, setKeyMgrOpen] = useState(false);
  const [groupMgrOpen, setGroupMgrOpen] = useState(false);
  const [snippetMgrOpen, setSnippetMgrOpen] = useState(false);
  const [aiMgrOpen, setAiMgrOpen] = useState(false);
  const [knownHostsOpen, setKnownHostsOpen] = useState(false);
  const [configBackupOpen, setConfigBackupOpen] = useState(false);

  useEffect(() => {
    const onNew = () => setDialogOpen(true);
    window.addEventListener("hyper:new-session", onNew);
    return () => window.removeEventListener("hyper:new-session", onNew);
  }, []);

  const [editing, setEditing] = useState<Session | null>(null);
  const [collapsed, setCollapsedState] = useState<Set<string>>(loadCollapsed());
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingGroupDelete, setPendingGroupDelete] = useState<Group | null>(
    null,
  );

  const toggleCollapsed = (gid: string) => {
    setCollapsedState((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      saveCollapsed(next);
      return next;
    });
  };

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const hay = `${s.name} ${s.host ?? ""} ${s.user ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sessions, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const g of groups) map.set(g.id, []);
    map.set("__none__", []);
    for (const s of filteredSessions) {
      const gid = s.groupId && map.has(s.groupId) ? s.groupId : "__none__";
      map.get(gid)!.push(s);
    }
    return map;
  }, [filteredSessions, groups]);

  return (
    <>
      <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
        <div
          data-tauri-drag-region
          className="flex h-10 items-center justify-center border-b border-neutral-800 select-none"
        >
          <div
            data-tauri-drag-region
            className="flex items-center gap-1"
            title="Stelo"
          >
            <Sparkles
              size={11}
              className="text-indigo-300/70"
              strokeWidth={2.5}
            />
            <span
              data-tauri-drag-region
              className="text-xs font-semibold tracking-[0.18em] text-neutral-200"
            >
              STELO
            </span>
          </div>
        </div>

        <div className="relative mx-2 mt-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sidebar.searchPlaceholder")}
            className="w-full rounded border border-neutral-700 bg-neutral-950 py-1 pl-6 pr-6 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-blue-500"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-auto py-1">
          {sessions.length === 0 && groups.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-neutral-500">
              {t("sidebar.empty")}
            </div>
          )}

          {groups.map((g) => {
            const list = grouped.get(g.id) ?? [];
            const isCollapsed = collapsed.has(g.id);
            return (
              <GroupBlock
                key={g.id}
                group={g}
                sessions={list}
                activeId={activeId}
                collapsed={isCollapsed}
                onToggle={() => toggleCollapsed(g.id)}
                onSetActive={setActive}
                onCloseSession={closeSession}
                onEditSession={setEditing}
                renaming={renaming === g.id}
                renameValue={renameValue}
                onStartRename={() => {
                  setRenaming(g.id);
                  setRenameValue(g.name);
                }}
                onRenameChange={setRenameValue}
                onRenameConfirm={() => {
                  if (renameValue.trim()) {
                    updateGroup(g.id, { name: renameValue.trim() });
                  }
                  setRenaming(null);
                }}
                onRenameCancel={() => setRenaming(null)}
                onDeleteGroup={() => setPendingGroupDelete(g)}
              />
            );
          })}

          {(grouped.get("__none__")?.length ?? 0) > 0 && (
            <GroupBlock
              key="__none__"
              group={{ id: "__none__", name: t("sidebar.ungrouped"), order: 9999 }}
              sessions={grouped.get("__none__")!}
              activeId={activeId}
              collapsed={collapsed.has("__none__")}
              onToggle={() => toggleCollapsed("__none__")}
              onSetActive={setActive}
              onCloseSession={closeSession}
              onEditSession={setEditing}
              isUngrouped
            />
          )}
        </div>

        <button
          onClick={() => setDialogOpen(true)}
          className="mx-2 mt-2 flex items-center justify-center gap-1 rounded-md bg-linear-to-br from-blue-500 to-blue-600 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:brightness-110 hover:shadow-md"
        >
          <Plus size={14} /> {t("sidebar.newSession")}
        </button>
        <div className="mx-2 mt-1 grid grid-cols-3 gap-1">
          <SideIconBtn
            onClick={() => setKeyMgrOpen(true)}
            icon={<KeyRound size={14} />}
            label={t("sidebar.btn.keys")}
          />
          <SideIconBtn
            onClick={() => setGroupMgrOpen(true)}
            icon={<FolderOpen size={14} />}
            label={t("sidebar.btn.groups")}
          />
          <SideIconBtn
            onClick={() => setSnippetMgrOpen(true)}
            icon={<Zap size={14} />}
            label={t("sidebar.btn.snippets")}
            title={t("sidebar.btn.snippets.tip")}
          />
          <SideIconBtn
            onClick={() =>
              window.dispatchEvent(new CustomEvent("hyper:open-ai"))
            }
            icon={<Sparkles size={14} />}
            label={t("sidebar.btn.ai")}
            title={t("sidebar.btn.ai.tip")}
          />
          <SideIconBtn
            onClick={() => setKnownHostsOpen(true)}
            icon={<ShieldCheck size={14} />}
            label={t("sidebar.btn.hosts")}
            title={t("sidebar.btn.hosts.tip")}
          />
          <SideIconBtn
            onClick={() => setConfigBackupOpen(true)}
            icon={<Database size={14} />}
            label={t("sidebar.btn.backup")}
            title={t("sidebar.btn.backup.tip")}
          />
        </div>
        <div className="m-2 space-y-1 border-t border-neutral-800 pt-2">
          <ThemeMenu />
          <LangMenu />
        </div>
      </aside>

      <NewSessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
      {editing && (
        <EditSessionDialog
          session={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {keyMgrOpen && <KeyManagerDialog onClose={() => setKeyMgrOpen(false)} />}
      {groupMgrOpen && (
        <GroupManagerDialog onClose={() => setGroupMgrOpen(false)} />
      )}
      {snippetMgrOpen && (
        <SnippetManagerDialog onClose={() => setSnippetMgrOpen(false)} />
      )}
      {aiMgrOpen && <AiManagerDialog onClose={() => setAiMgrOpen(false)} />}
      {knownHostsOpen && (
        <KnownHostsDialog onClose={() => setKnownHostsOpen(false)} />
      )}
      {configBackupOpen && (
        <ConfigBackupDialog onClose={() => setConfigBackupOpen(false)} />
      )}
      {pendingGroupDelete && (
        <ConfirmDialog
          title="删除分组"
          message={`确认删除分组"${pendingGroupDelete.name}"？组内会话会移到"未分组"。`}
          confirmText="删除"
          danger
          onConfirm={() => {
            const gid = pendingGroupDelete.id;
            for (const s of sessions) {
              if (s.groupId === gid) updateMeta(s.id, { groupId: undefined });
            }
            removeGroup(gid);
            setPendingGroupDelete(null);
          }}
          onCancel={() => setPendingGroupDelete(null)}
        />
      )}
    </>
  );
}

type GroupBlockProps = {
  group: Group;
  sessions: Session[];
  activeId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onSetActive: (id: string) => void;
  onCloseSession: (id: string) => void;
  onEditSession: (s: Session) => void;
  isUngrouped?: boolean;
  renaming?: boolean;
  renameValue?: string;
  onStartRename?: () => void;
  onRenameChange?: (v: string) => void;
  onRenameConfirm?: () => void;
  onRenameCancel?: () => void;
  onDeleteGroup?: () => void;
};

function GroupBlock({
  group,
  sessions,
  activeId,
  collapsed,
  onToggle,
  onSetActive,
  onCloseSession,
  onEditSession,
  isUngrouped,
  renaming,
  renameValue,
  onStartRename,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
  onDeleteGroup,
}: GroupBlockProps) {
  return (
    <div>
      <div className="group flex items-center gap-1 px-1 py-0.5 text-xs uppercase tracking-wider text-neutral-500">
        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left hover:bg-neutral-800/40"
        >
          <span className="shrink-0">
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </span>
          {renaming ? (
            <input
              autoFocus
              value={renameValue ?? ""}
              onChange={(e) => onRenameChange?.(e.target.value)}
              onBlur={() => onRenameConfirm?.()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRenameConfirm?.();
                if (e.key === "Escape") onRenameCancel?.();
              }}
              className="min-w-0 flex-1 rounded border border-blue-600 bg-neutral-950 px-1 text-xs normal-case text-neutral-100 outline-none"
            />
          ) : (
            <span className="truncate">{group.name}</span>
          )}
          <span className="shrink-0 text-neutral-600">
            {sessions.length}
          </span>
        </button>
        {!isUngrouped && !renaming && (
          <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
            <button
              onClick={onStartRename}
              className="rounded p-0.5 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100"
              title="重命名"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={onDeleteGroup}
              className="rounded p-0.5 text-neutral-500 hover:bg-red-900/60 hover:text-red-200"
              title="删除分组"
            >
              <X size={11} />
            </button>
          </div>
        )}
      </div>

      {!collapsed && (
        <div>
          {sessions.length === 0 && (
            <div className="px-3 py-1 text-xs text-neutral-600">
              （空）
            </div>
          )}
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              s={s}
              active={activeId === s.id}
              onSetActive={onSetActive}
              onCloseSession={onCloseSession}
              onEditSession={onEditSession}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  s,
  active,
  onSetActive,
  onCloseSession,
  onEditSession,
}: {
  s: Session;
  active: boolean;
  onSetActive: (id: string) => void;
  onCloseSession: (id: string) => void;
  onEditSession: (s: Session) => void;
}) {
  const toggleSyncInput = useSessionStore((st) => st.toggleSyncInput);
  const color = colorHex(s.colorLabel);
  return (
    <div
      className={cn(
        "group relative flex w-full items-center gap-1 pr-1 text-sm transition-colors hover:bg-neutral-800/60",
        active &&
          "bg-linear-to-r from-blue-500/10 to-transparent font-medium text-neutral-100",
      )}
    >
      {s.colorLabel && (
        <span
          className="absolute left-0 top-0 h-full w-0.75"
          style={{ background: color }}
        />
      )}
      {active && !s.colorLabel && (
        <span className="absolute left-0 top-0 h-full w-0.75 bg-linear-to-b from-blue-500 to-blue-600" />
      )}
      <button
        onClick={() => onSetActive(s.id)}
        onDoubleClick={() => {
          onSetActive(s.id);
          if (s.kind === "ssh" && !s.backendId) {
            autoConnect(s);
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-2 truncate px-3 py-1.5 text-left"
        title={
          s.kind === "ssh" && !s.backendId
            ? "双击以自动连接（使用保存的凭据）"
            : (s.errorMsg ?? s.status)
        }
      >
        <StatusDot status={s.status} />
        <span className="truncate">{s.name}</span>
        {s.syncInput && (
          <span
            className="shrink-0 rounded bg-amber-500/25 p-0.5 text-amber-300"
            title="参与同步输入"
          >
            <Radio size={11} />
          </span>
        )}
      </button>
      {s.kind === "ssh" && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleSyncInput(s.id);
            }}
            className={cn(
              "rounded p-1",
              s.syncInput
                ? "bg-amber-500/30 text-amber-300"
                : "text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100",
            )}
            title="多会话同步输入（勾选多个后，active 会话的输入广播到这些会话）"
          >
            <Radio size={11} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditSession(s);
            }}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100"
            title="编辑"
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`确认删除会话"${s.name}"?`)) {
                onCloseSession(s.id);
              }
            }}
            className="rounded p-1 text-neutral-500 hover:bg-red-900/60 hover:text-red-200"
            title="删除"
          >
            <X size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    {
      idle: "bg-neutral-600",
      connecting: "bg-amber-500 animate-pulse",
      connected: "bg-emerald-500",
      error: "bg-red-500",
      closed: "bg-neutral-600",
    }[status] ?? "bg-neutral-600";
  return <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cls)} />;
}

function SideIconBtn({
  onClick,
  icon,
  label,
  title,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded py-1.5 text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
    >
      <span className="text-neutral-500 transition-colors group-hover:text-neutral-100">
        {icon}
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
