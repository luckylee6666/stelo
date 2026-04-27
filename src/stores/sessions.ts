import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { stopForwardsForSession } from "../lib/forwards";

export type SessionKind = "local" | "ssh";
export type SessionStatus =
  | "connecting"
  | "connected"
  | "error"
  | "closed";

export type AuthMode = "password" | "private_key";

export type PortForward = {
  id: string;
  kind: "local";
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  enabled: boolean;
};

export type Session = {
  id: string;
  name: string;
  kind: SessionKind;
  host?: string;
  port?: number;
  user?: string;
  authMode?: AuthMode;
  keyPath?: string;
  /** 引用密钥库里某条密钥的 id；若有则优先于 keyPath */
  keyId?: string;
  groupId?: string;
  backendId?: string;
  status: SessionStatus;
  errorMsg?: string;
  /** 远端 shell 当前 cwd（通过 OSC 7 自动同步） */
  cwd?: string;
  /** 端口转发规则 */
  portForwards?: PortForward[];
  /** 颜色标签 */
  colorLabel?: string;
  /** 参与多会话同步输入 */
  syncInput?: boolean;
};

export type SavedPortForward = {
  id: string;
  kind: "local";
  local_host: string;
  local_port: number;
  remote_host: string | null;
  remote_port: number | null;
  enabled: boolean;
};

export type SavedSession = {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  auth_mode: AuthMode;
  key_path: string | null;
  key_id: string | null;
  group_id: string | null;
  port_forwards: SavedPortForward[];
  color_label: string | null;
  sync_input: boolean;
};

type Store = {
  sessions: Session[];
  activeId: string | null;
  addLocal: () => string;
  addSshConnected: (cfg: {
    host: string;
    port: number;
    user: string;
    backendId: string;
    authMode: AuthMode;
    keyPath?: string;
    keyId?: string;
    groupId?: string;
    name?: string;
  }) => string;
  attachBackend: (sessionId: string, backendId: string) => void;
  setActive: (id: string) => void;
  closeSession: (id: string) => void;
  setStatus: (id: string, status: SessionStatus, errorMsg?: string) => void;
  setCwd: (id: string, cwd: string) => void;
  disconnectSession: (id: string) => void;
  updateMeta: (
    id: string,
    patch: Partial<
      Pick<
        Session,
        | "name"
        | "host"
        | "port"
        | "user"
        | "keyPath"
        | "keyId"
        | "groupId"
        | "portForwards"
        | "colorLabel"
        | "syncInput"
      >
    >,
  ) => void;
  toggleSyncInput: (id: string) => void;
  hydrateFromSaved: (list: SavedSession[]) => void;
};

let counter = 0;
const newId = () => `s-${Date.now()}-${counter++}`;

export const useSessionStore = create<Store>((set, get) => ({
  sessions: [],
  activeId: null,
  addLocal: () => {
    const id = newId();
    set((state) => ({
      sessions: [
        ...state.sessions,
        {
          id,
          kind: "local",
          name: `本地 ${state.sessions.filter((s) => s.kind === "local").length + 1}`,
          status: "connected",
        },
      ],
      activeId: id,
    }));
    return id;
  },
  addSshConnected: ({
    host,
    port,
    user,
    backendId,
    authMode,
    keyPath,
    keyId,
    groupId,
    name,
  }) => {
    const id = newId();
    set((state) => ({
      sessions: [
        ...state.sessions,
        {
          id,
          kind: "ssh",
          name: name ?? `${user}@${host}${port === 22 ? "" : `:${port}`}`,
          host,
          port,
          user,
          authMode,
          keyPath,
          keyId,
          groupId,
          backendId,
          status: "connected",
        },
      ],
      activeId: id,
    }));
    return id;
  },
  attachBackend: (sessionId, backendId) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? { ...s, backendId, status: "connected", errorMsg: undefined }
          : s,
      ),
    })),
  setActive: (id) => set({ activeId: id }),
  closeSession: (id) => {
    const target = get().sessions.find((s) => s.id === id);
    if (target) {
      stopForwardsForSession(target).catch(() => {});
    }
    if (target?.backendId) {
      invoke("ssh_disconnect", { sessionId: target.backendId }).catch((e) =>
        console.error("ssh_disconnect failed:", e),
      );
    }
    if (target?.kind === "ssh") {
      invoke("credential_delete", { account: `${id}:password` }).catch(() => {});
      invoke("credential_delete", { account: `${id}:passphrase` }).catch(() => {});
    }
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id);
      const activeId =
        state.activeId === id
          ? sessions[sessions.length - 1]?.id ?? null
          : state.activeId;
      return { sessions, activeId };
    });
  },
  setStatus: (id, status, errorMsg) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status, errorMsg } : s,
      ),
    })),
  setCwd: (id, cwd) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, cwd } : s)),
    })),
  disconnectSession: (id) => {
    const target = get().sessions.find((s) => s.id === id);
    if (target) {
      stopForwardsForSession(target).catch(() => {});
    }
    if (target?.backendId) {
      invoke("ssh_disconnect", { sessionId: target.backendId }).catch((e) =>
        console.error("ssh_disconnect failed:", e),
      );
    }
    set((state) => {
      let sessions: Session[];
      if (target?.kind === "local") {
        sessions = state.sessions.filter((s) => s.id !== id);
      } else {
        sessions = state.sessions.map((s) =>
          s.id === id
            ? {
                ...s,
                backendId: undefined,
                cwd: undefined,
                status: "closed",
                errorMsg: undefined,
              }
            : s,
        );
      }
      // 当关闭的是当前 active 时，切到下一个"活动 tab"
      let activeId = state.activeId;
      if (activeId === id) {
        const active = sessions.filter(
          (s) => s.backendId || s.status === "connecting" || s.kind === "local",
        );
        activeId = active[active.length - 1]?.id ?? null;
      }
      return { sessions, activeId };
    });
  },
  updateMeta: (id, patch) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id
          ? {
              ...s,
              ...patch,
              name:
                patch.name !== undefined
                  ? patch.name || s.name
                  : s.name,
            }
          : s,
      ),
    })),
  toggleSyncInput: (id) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, syncInput: !s.syncInput } : s,
      ),
    })),
  hydrateFromSaved: (list) => {
    set(() => ({
      sessions: list.map<Session>((s) => ({
        id: s.id,
        kind: "ssh",
        name: s.name,
        host: s.host,
        port: s.port,
        user: s.user,
        authMode: s.auth_mode,
        keyPath: s.key_path ?? undefined,
        keyId: s.key_id ?? undefined,
        groupId: s.group_id ?? undefined,
        portForwards: (s.port_forwards ?? []).map((pf) => ({
          id: pf.id,
          kind: "local",
          localHost: pf.local_host,
          localPort: pf.local_port,
          remoteHost: pf.remote_host ?? "",
          remotePort: pf.remote_port ?? 0,
          enabled: pf.enabled,
        })),
        colorLabel: s.color_label ?? undefined,
        syncInput: !!s.sync_input,
        status: "closed",
      })),
      activeId: null,
    }));
  },
}));

export function toSavedSessions(sessions: Session[]): SavedSession[] {
  return sessions
    .filter(
      (s): s is Session & { host: string; port: number; user: string; authMode: AuthMode } =>
        s.kind === "ssh" &&
        typeof s.host === "string" &&
        typeof s.port === "number" &&
        typeof s.user === "string" &&
        typeof s.authMode === "string",
    )
    .map((s) => ({
      id: s.id,
      name: s.name,
      host: s.host,
      port: s.port,
      user: s.user,
      auth_mode: s.authMode,
      key_path: s.keyPath ?? null,
      key_id: s.keyId ?? null,
      group_id: s.groupId ?? null,
      port_forwards: (s.portForwards ?? []).map<SavedPortForward>((pf) => ({
        id: pf.id,
        kind: pf.kind,
        local_host: pf.localHost,
        local_port: pf.localPort,
        remote_host: pf.remoteHost || null,
        remote_port: pf.remotePort || null,
        enabled: pf.enabled,
      })),
      color_label: s.colorLabel ?? null,
      sync_input: !!s.syncInput,
    }));
}

export const COLOR_LABELS: { id: string; name: string; hex: string }[] = [
  { id: "", name: "无", hex: "transparent" },
  { id: "red", name: "红 · 生产", hex: "#ef4444" },
  { id: "orange", name: "橙 · 预发", hex: "#f97316" },
  { id: "yellow", name: "黄 · 测试", hex: "#eab308" },
  { id: "green", name: "绿 · 开发", hex: "#22c55e" },
  { id: "blue", name: "蓝", hex: "#3b82f6" },
  { id: "purple", name: "紫", hex: "#a855f7" },
];

export function colorHex(id: string | undefined): string {
  if (!id) return "transparent";
  return COLOR_LABELS.find((c) => c.id === id)?.hex ?? "transparent";
}
