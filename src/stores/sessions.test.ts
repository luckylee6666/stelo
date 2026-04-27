import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/forwards", () => ({
  stopForwardsForSession: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

import {
  useSessionStore,
  toSavedSessions,
  colorHex,
  COLOR_LABELS,
  type Session,
  type SavedSession,
} from "./sessions";

describe("colorHex", () => {
  it("returns transparent for undefined", () => {
    expect(colorHex(undefined)).toBe("transparent");
  });

  it("returns transparent for empty", () => {
    expect(colorHex("")).toBe("transparent");
  });

  it("returns correct hex for known labels", () => {
    expect(colorHex("red")).toBe("#ef4444");
    expect(colorHex("blue")).toBe("#3b82f6");
    expect(colorHex("purple")).toBe("#a855f7");
  });

  it("returns transparent for unknown label", () => {
    expect(colorHex("rainbow")).toBe("transparent");
  });

  it("COLOR_LABELS covers all expected colors", () => {
    const ids = COLOR_LABELS.map((c) => c.id);
    for (const c of ["", "red", "orange", "yellow", "green", "blue", "purple"]) {
      expect(ids).toContain(c);
    }
  });
});

describe("toSavedSessions", () => {
  it("filters out local-only sessions", () => {
    const sessions: Session[] = [
      { id: "l", kind: "local", name: "local", status: "connected" },
      {
        id: "s",
        kind: "ssh",
        name: "s",
        host: "h",
        port: 22,
        user: "u",
        authMode: "password",
        status: "closed",
      },
    ];
    const saved = toSavedSessions(sessions);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("s");
  });

  it("filters out ssh sessions missing required fields", () => {
    const sessions: Session[] = [
      {
        id: "incomplete",
        kind: "ssh",
        name: "bad",
        host: "h",
        status: "closed",
      } as Session,
    ];
    expect(toSavedSessions(sessions)).toHaveLength(0);
  });

  it("maps camelCase fields to snake_case", () => {
    const sessions: Session[] = [
      {
        id: "s",
        kind: "ssh",
        name: "n",
        host: "h",
        port: 22,
        user: "u",
        authMode: "private_key",
        keyPath: "/k",
        keyId: "kid",
        groupId: "g",
        colorLabel: "red",
        syncInput: true,
        status: "closed",
        portForwards: [
          {
            id: "pf",
            kind: "local",
            localHost: "127.0.0.1",
            localPort: 3307,
            remoteHost: "127.0.0.1",
            remotePort: 3306,
            enabled: true,
          },
        ],
      },
    ];
    const saved = toSavedSessions(sessions);
    expect(saved[0]).toEqual<SavedSession>({
      id: "s",
      name: "n",
      host: "h",
      port: 22,
      user: "u",
      auth_mode: "private_key",
      key_path: "/k",
      key_id: "kid",
      group_id: "g",
      color_label: "red",
      sync_input: true,
      port_forwards: [
        {
          id: "pf",
          kind: "local",
          local_host: "127.0.0.1",
          local_port: 3307,
          remote_host: "127.0.0.1",
          remote_port: 3306,
          enabled: true,
        },
      ],
    });
  });

  it("converts missing optional fields to null", () => {
    const sessions: Session[] = [
      {
        id: "s",
        kind: "ssh",
        name: "n",
        host: "h",
        port: 22,
        user: "u",
        authMode: "password",
        status: "closed",
      },
    ];
    const saved = toSavedSessions(sessions);
    expect(saved[0].key_path).toBeNull();
    expect(saved[0].key_id).toBeNull();
    expect(saved[0].group_id).toBeNull();
    expect(saved[0].color_label).toBeNull();
    expect(saved[0].sync_input).toBe(false);
    expect(saved[0].port_forwards).toEqual([]);
  });
});

describe("useSessionStore", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], activeId: null });
  });

  it("addLocal creates a local session and activates it", () => {
    const id = useSessionStore.getState().addLocal();
    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].id).toBe(id);
    expect(state.sessions[0].kind).toBe("local");
    expect(state.activeId).toBe(id);
  });

  it("addSshConnected populates fields and sets status connected", () => {
    const id = useSessionStore.getState().addSshConnected({
      host: "h",
      port: 22,
      user: "u",
      backendId: "be",
      authMode: "password",
    });
    const s = useSessionStore.getState().sessions.find((x) => x.id === id)!;
    expect(s.status).toBe("connected");
    expect(s.backendId).toBe("be");
    expect(s.name).toBe("u@h"); // port=22 省略
  });

  it("addSshConnected shows port when non-22", () => {
    const id = useSessionStore.getState().addSshConnected({
      host: "h",
      port: 2222,
      user: "u",
      backendId: "be",
      authMode: "password",
    });
    const s = useSessionStore.getState().sessions.find((x) => x.id === id)!;
    expect(s.name).toBe("u@h:2222");
  });

  it("setCwd updates only the target session", () => {
    const a = useSessionStore.getState().addLocal();
    const b = useSessionStore.getState().addLocal();
    useSessionStore.getState().setCwd(a, "/tmp");
    const state = useSessionStore.getState();
    expect(state.sessions.find((s) => s.id === a)?.cwd).toBe("/tmp");
    expect(state.sessions.find((s) => s.id === b)?.cwd).toBeUndefined();
  });

  it("setStatus with errorMsg", () => {
    const id = useSessionStore.getState().addLocal();
    useSessionStore.getState().setStatus(id, "error", "boom");
    const s = useSessionStore.getState().sessions[0];
    expect(s.status).toBe("error");
    expect(s.errorMsg).toBe("boom");
  });

  it("toggleSyncInput flips the flag", () => {
    const id = useSessionStore.getState().addLocal();
    useSessionStore.getState().toggleSyncInput(id);
    expect(useSessionStore.getState().sessions[0].syncInput).toBe(true);
    useSessionStore.getState().toggleSyncInput(id);
    expect(useSessionStore.getState().sessions[0].syncInput).toBe(false);
  });

  it("hydrateFromSaved maps saved list back to sessions with status=closed", () => {
    const saved: SavedSession[] = [
      {
        id: "s1",
        name: "n",
        host: "h",
        port: 22,
        user: "u",
        auth_mode: "private_key",
        key_path: "/k",
        key_id: "kid",
        group_id: null,
        color_label: "green",
        sync_input: false,
        port_forwards: [
          {
            id: "pf",
            kind: "local",
            local_host: "127.0.0.1",
            local_port: 80,
            remote_host: "example.com",
            remote_port: 8080,
            enabled: true,
          },
        ],
      },
    ];
    useSessionStore.getState().hydrateFromSaved(saved);
    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    const s = state.sessions[0];
    expect(s.status).toBe("closed");
    expect(s.kind).toBe("ssh");
    expect(s.keyPath).toBe("/k");
    expect(s.keyId).toBe("kid");
    expect(s.groupId).toBeUndefined();
    expect(s.colorLabel).toBe("green");
    expect(s.portForwards?.[0].remoteHost).toBe("example.com");
    expect(s.portForwards?.[0].remotePort).toBe(8080);
    expect(state.activeId).toBeNull();
  });

  it("closeSession switches activeId away from removed session", () => {
    const a = useSessionStore.getState().addLocal();
    const b = useSessionStore.getState().addLocal();
    useSessionStore.getState().setActive(a);
    useSessionStore.getState().closeSession(a);
    const state = useSessionStore.getState();
    expect(state.sessions.find((s) => s.id === a)).toBeUndefined();
    expect(state.activeId).toBe(b);
  });
});
