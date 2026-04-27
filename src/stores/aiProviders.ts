import { create } from "zustand";

export type AiKind = "claude" | "openai";

export type AiProvider = {
  id: string;
  name: string;
  kind: AiKind;
  apiBase: string;
  model: string;
  maxTokens: number;
};

type Store = {
  providers: AiProvider[];
  activeId: string | null;
  addProvider: (p: Omit<AiProvider, "id">) => string;
  updateProvider: (id: string, patch: Partial<Omit<AiProvider, "id">>) => void;
  removeProvider: (id: string) => void;
  setActive: (id: string | null) => void;
  hydrate: (list: AiProvider[]) => void;
};

const LS_ACTIVE = "hypershell.aiActiveId";

let counter = 0;
const newId = () => `ai-${Date.now()}-${counter++}`;

export const useAiStore = create<Store>((set) => ({
  providers: [],
  activeId: localStorage.getItem(LS_ACTIVE),
  addProvider: (p) => {
    const id = newId();
    set((s) => ({
      providers: [...s.providers, { ...p, id }],
      activeId: s.activeId ?? id,
    }));
    if (!localStorage.getItem(LS_ACTIVE)) {
      localStorage.setItem(LS_ACTIVE, id);
    }
    return id;
  },
  updateProvider: (id, patch) =>
    set((s) => ({
      providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
  removeProvider: (id) =>
    set((s) => {
      const next = s.providers.filter((p) => p.id !== id);
      const activeId = s.activeId === id ? (next[0]?.id ?? null) : s.activeId;
      if (activeId) localStorage.setItem(LS_ACTIVE, activeId);
      else localStorage.removeItem(LS_ACTIVE);
      return { providers: next, activeId };
    }),
  setActive: (id) => {
    if (id) localStorage.setItem(LS_ACTIVE, id);
    else localStorage.removeItem(LS_ACTIVE);
    set({ activeId: id });
  },
  hydrate: (list) => {
    const saved = localStorage.getItem(LS_ACTIVE);
    const activeId =
      saved && list.some((p) => p.id === saved) ? saved : (list[0]?.id ?? null);
    set({ providers: list, activeId });
  },
}));

export const PRESETS: { name: string; kind: AiKind; apiBase: string; model: string }[] =
  [
    {
      name: "Claude Sonnet 4.6",
      kind: "claude",
      apiBase: "https://api.anthropic.com",
      model: "claude-sonnet-4-6",
    },
    {
      name: "Claude Haiku 4.5",
      kind: "claude",
      apiBase: "https://api.anthropic.com",
      model: "claude-haiku-4-5-20251001",
    },
    {
      name: "OpenAI GPT-4o",
      kind: "openai",
      apiBase: "https://api.openai.com/v1",
      model: "gpt-4o",
    },
    {
      name: "DeepSeek Chat",
      kind: "openai",
      apiBase: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    },
    {
      name: "Kimi (Moonshot)",
      kind: "openai",
      apiBase: "https://api.moonshot.cn/v1",
      model: "moonshot-v1-8k",
    },
    {
      name: "通义千问",
      kind: "openai",
      apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
    },
    {
      name: "MiniMax Token Plan",
      kind: "claude",
      apiBase: "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M2.7",
    },
    {
      name: "Ollama 本地",
      kind: "openai",
      apiBase: "http://localhost:11434/v1",
      model: "llama3.1",
    },
  ];
