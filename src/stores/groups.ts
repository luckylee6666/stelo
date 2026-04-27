import { create } from "zustand";

export type Group = {
  id: string;
  name: string;
  order: number;
};

type Store = {
  groups: Group[];
  addGroup: (name: string) => string;
  updateGroup: (id: string, patch: Partial<Pick<Group, "name" | "order">>) => void;
  removeGroup: (id: string) => void;
  hydrate: (list: Group[]) => void;
};

let counter = 0;
const newId = () => `g-${Date.now()}-${counter++}`;

export const useGroupStore = create<Store>((set) => ({
  groups: [],
  addGroup: (name) => {
    const id = newId();
    set((s) => ({
      groups: [...s.groups, { id, name, order: s.groups.length }],
    }));
    return id;
  },
  updateGroup: (id, patch) =>
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    })),
  removeGroup: (id) =>
    set((s) => ({ groups: s.groups.filter((g) => g.id !== id) })),
  hydrate: (list) => set({ groups: [...list].sort((a, b) => a.order - b.order) }),
}));
