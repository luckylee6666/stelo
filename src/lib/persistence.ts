import { invoke } from "@tauri-apps/api/core";
import {
  useSessionStore,
  toSavedSessions,
  type SavedSession,
} from "../stores/sessions";
import { useKeyStore, type SshKey } from "../stores/keys";
import { useGroupStore, type Group } from "../stores/groups";
import { useSnippetStore, type Snippet } from "../stores/snippets";
import { useHistoryStore, type HistoryItem } from "../stores/history";
import { useAiStore, type AiProvider } from "../stores/aiProviders";

type SavedKey = { id: string; name: string; path: string };
type SavedGroup = { id: string; name: string; order: number };
type SavedSnippet = {
  id: string;
  name: string;
  command: string;
  use_count: number;
  last_used_at: number;
};
type SavedHistoryItem = { command: string; count: number; last_at: number };
type SavedAiProvider = {
  id: string;
  name: string;
  kind: "claude" | "openai";
  api_base: string;
  model: string;
  max_tokens: number;
};

let sessionsReady = false;
let keysReady = false;
let groupsReady = false;
let snippetsReady = false;
let historyReady = false;
let aiReady = false;
let lastSessions: unknown = null;
let lastKeys: unknown = null;
let lastGroups: unknown = null;
let lastSnippets: unknown = null;
let lastHistory: unknown = null;
let lastAi: unknown = null;

export async function loadAll() {
  // 三个 load 独立 try/catch：某一个坏掉不影响其他，也不会意外让 autoSave 覆盖原文件。
  try {
    const sessions = await invoke<SavedSession[]>("sessions_load");
    useSessionStore.getState().hydrateFromSaved(sessions);
    sessionsReady = true;
  } catch (e) {
    console.error(
      "sessions_load failed, autoSave disabled for sessions to protect file:",
      e,
    );
  }
  try {
    const keys = await invoke<SavedKey[]>("keys_load");
    useKeyStore.getState().hydrate(keys);
    keysReady = true;
  } catch (e) {
    console.error("keys_load failed:", e);
  }
  try {
    const groups = await invoke<SavedGroup[]>("groups_load");
    useGroupStore.getState().hydrate(groups);
    groupsReady = true;
  } catch (e) {
    console.error("groups_load failed:", e);
  }
  try {
    const snippets = await invoke<SavedSnippet[]>("snippets_load");
    useSnippetStore.getState().hydrate(
      snippets.map((s) => ({
        id: s.id,
        name: s.name,
        command: s.command,
        useCount: s.use_count ?? 0,
        lastUsedAt: s.last_used_at ?? 0,
      })),
    );
    snippetsReady = true;
  } catch (e) {
    console.error("snippets_load failed:", e);
  }
  try {
    const history = await invoke<SavedHistoryItem[]>("history_load");
    useHistoryStore.getState().hydrate(
      history.map((h) => ({
        command: h.command,
        count: h.count,
        lastAt: h.last_at,
      })),
    );
    historyReady = true;
  } catch (e) {
    console.error("history_load failed:", e);
  }
  try {
    const ai = await invoke<SavedAiProvider[]>("ai_providers_load");
    useAiStore.getState().hydrate(
      ai.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        apiBase: p.api_base,
        model: p.model,
        maxTokens: p.max_tokens ?? 1024,
      })),
    );
    aiReady = true;
  } catch (e) {
    console.error("ai_providers_load failed:", e);
  }
  lastSessions = useSessionStore.getState().sessions;
  lastKeys = useKeyStore.getState().keys;
  lastGroups = useGroupStore.getState().groups;
  lastSnippets = useSnippetStore.getState().snippets;
  lastHistory = useHistoryStore.getState().items;
  lastAi = useAiStore.getState().providers;
}

export function startAutoSave(): () => void {
  const u1 = useSessionStore.subscribe((state) => {
    if (!sessionsReady) return;
    if (state.sessions === lastSessions) return;
    lastSessions = state.sessions;
    const list = toSavedSessions(state.sessions);
    invoke("sessions_save", { sessions: list }).catch((e) =>
      console.error("sessions_save failed:", e),
    );
  });
  const u2 = useKeyStore.subscribe((state) => {
    if (!keysReady) return;
    if (state.keys === lastKeys) return;
    lastKeys = state.keys;
    const list: SavedKey[] = state.keys.map((k: SshKey) => ({
      id: k.id,
      name: k.name,
      path: k.path,
    }));
    invoke("keys_save", { keys: list }).catch((e) =>
      console.error("keys_save failed:", e),
    );
  });
  const u3 = useGroupStore.subscribe((state) => {
    if (!groupsReady) return;
    if (state.groups === lastGroups) return;
    lastGroups = state.groups;
    const list: SavedGroup[] = state.groups.map((g: Group, i: number) => ({
      id: g.id,
      name: g.name,
      order: g.order ?? i,
    }));
    invoke("groups_save", { groups: list }).catch((e) =>
      console.error("groups_save failed:", e),
    );
  });
  const u4 = useSnippetStore.subscribe((state) => {
    if (!snippetsReady) return;
    if (state.snippets === lastSnippets) return;
    lastSnippets = state.snippets;
    const list: SavedSnippet[] = state.snippets.map((s: Snippet) => ({
      id: s.id,
      name: s.name,
      command: s.command,
      use_count: s.useCount ?? 0,
      last_used_at: s.lastUsedAt ?? 0,
    }));
    invoke("snippets_save", { snippets: list }).catch((e) =>
      console.error("snippets_save failed:", e),
    );
  });
  // 历史记录节流保存（避免每次输入都写入磁盘）
  let historySaveTimer: number | null = null;
  const u5 = useHistoryStore.subscribe((state) => {
    if (!historyReady) return;
    if (state.items === lastHistory) return;
    lastHistory = state.items;
    if (historySaveTimer) window.clearTimeout(historySaveTimer);
    historySaveTimer = window.setTimeout(() => {
      const list: SavedHistoryItem[] = state.items.map((h: HistoryItem) => ({
        command: h.command,
        count: h.count,
        last_at: h.lastAt,
      }));
      invoke("history_save", { items: list }).catch((e) =>
        console.error("history_save failed:", e),
      );
    }, 1500);
  });
  const u6 = useAiStore.subscribe((state) => {
    if (!aiReady) return;
    if (state.providers === lastAi) return;
    lastAi = state.providers;
    const list: SavedAiProvider[] = state.providers.map((p: AiProvider) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      api_base: p.apiBase,
      model: p.model,
      max_tokens: p.maxTokens,
    }));
    invoke("ai_providers_save", { providers: list }).catch((e) =>
      console.error("ai_providers_save failed:", e),
    );
  });
  return () => {
    u1();
    u2();
    u3();
    u4();
    u5();
    u6();
  };
}

export const loadSessions = loadAll;
