import { create } from "zustand";
import { redactSecrets } from "../lib/redact";

export type HistoryItem = {
  command: string;
  count: number;
  lastAt: number;
};

const MAX_ITEMS = 500;
const MIN_LEN = 2;

type Store = {
  items: HistoryItem[];
  record: (command: string) => void;
  remove: (command: string) => void;
  clear: () => void;
  hydrate: (list: HistoryItem[]) => void;
};

export const useHistoryStore = create<Store>((set) => ({
  items: [],
  record: (raw) => {
    const trimmed = raw.trim();
    if (trimmed.length < MIN_LEN) return;
    // 跳过一些明显不是命令的输入（如纯回车、只含特殊字符）
    if (!/[a-zA-Z0-9]/.test(trimmed)) return;
    // 入库前脱敏：屏蔽误粘的 token/密码，免得 history.json 变成密码本
    const command = redactSecrets(trimmed);
    set((s) => {
      const idx = s.items.findIndex((x) => x.command === command);
      const now = Date.now();
      let next: HistoryItem[];
      if (idx >= 0) {
        next = s.items.map((x, i) =>
          i === idx ? { ...x, count: x.count + 1, lastAt: now } : x,
        );
      } else {
        next = [...s.items, { command, count: 1, lastAt: now }];
      }
      // 按 count 降序裁剪（保留最常用 MAX_ITEMS 条）
      if (next.length > MAX_ITEMS) {
        next = next
          .slice()
          .sort(
            (a, b) => b.count * 10 + b.lastAt / 1e10 - (a.count * 10 + a.lastAt / 1e10),
          )
          .slice(0, MAX_ITEMS);
      }
      return { items: next };
    });
  },
  remove: (command) =>
    set((s) => ({ items: s.items.filter((x) => x.command !== command) })),
  clear: () => set({ items: [] }),
  hydrate: (list) => set({ items: list }),
}));
