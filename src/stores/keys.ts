import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type SshKey = {
  id: string;
  name: string;
  path: string;
};

type Store = {
  keys: SshKey[];
  addKey: (name: string, path: string) => string;
  updateKey: (id: string, patch: Partial<Pick<SshKey, "name" | "path">>) => void;
  removeKey: (id: string) => void;
  hydrate: (list: SshKey[]) => void;
};

let counter = 0;
const newId = () => `k-${Date.now()}-${counter++}`;

export const useKeyStore = create<Store>((set) => ({
  keys: [],
  addKey: (name, path) => {
    const id = newId();
    set((s) => ({ keys: [...s.keys, { id, name, path }] }));
    return id;
  },
  updateKey: (id, patch) =>
    set((s) => ({
      keys: s.keys.map((k) => (k.id === id ? { ...k, ...patch } : k)),
    })),
  removeKey: (id) => {
    invoke("credential_delete", { account: `key:${id}:passphrase` }).catch(
      () => {},
    );
    set((s) => ({ keys: s.keys.filter((k) => k.id !== id) }));
  },
  hydrate: (list) => set({ keys: list }),
}));
