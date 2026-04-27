import { create } from "zustand";

export type Snippet = {
  id: string;
  name: string;
  command: string;
  useCount: number;
  lastUsedAt: number;
};

type Store = {
  snippets: Snippet[];
  addSnippet: (name: string, command: string) => string;
  updateSnippet: (
    id: string,
    patch: Partial<Pick<Snippet, "name" | "command" | "useCount" | "lastUsedAt">>,
  ) => void;
  removeSnippet: (id: string) => void;
  hydrate: (list: Snippet[]) => void;
  recordUse: (id: string) => void;
};

let counter = 0;
const newId = () => `sn-${Date.now()}-${counter++}`;

export const useSnippetStore = create<Store>((set) => ({
  snippets: [],
  addSnippet: (name, command) => {
    const id = newId();
    set((s) => ({
      snippets: [
        ...s.snippets,
        { id, name, command, useCount: 0, lastUsedAt: 0 },
      ],
    }));
    return id;
  },
  updateSnippet: (id, patch) =>
    set((s) => ({
      snippets: s.snippets.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  removeSnippet: (id) =>
    set((s) => ({ snippets: s.snippets.filter((x) => x.id !== id) })),
  hydrate: (list) =>
    set({
      snippets: list.map((s) => ({
        ...s,
        useCount: s.useCount ?? 0,
        lastUsedAt: s.lastUsedAt ?? 0,
      })),
    }),
  recordUse: (id) =>
    set((s) => ({
      snippets: s.snippets.map((x) =>
        x.id === id
          ? { ...x, useCount: (x.useCount ?? 0) + 1, lastUsedAt: Date.now() }
          : x,
      ),
    })),
}));
