import { create } from "zustand";
import type { CustomTheme } from "../lib/themes";

const LS_THEME = "hypershell.themeId";
const LS_CWD_PANEL = "hypershell.cwdPanelOpen";
const LS_CUSTOM_THEMES = "hypershell.customThemes";
const LS_FONT_SIZE = "hypershell.fontSize";

const MIN_FONT = 9;
const MAX_FONT = 28;
const clampFont = (n: number) => Math.max(MIN_FONT, Math.min(MAX_FONT, n));

function readBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v === "1" || v === "true";
}

function readStr(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

function readInt(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readCustomThemes(): CustomTheme[] {
  try {
    const v = localStorage.getItem(LS_CUSTOM_THEMES);
    if (!v) return [];
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t) => t && t.kind === "custom") as CustomTheme[];
  } catch {
    return [];
  }
}

function writeCustomThemes(list: CustomTheme[]) {
  localStorage.setItem(LS_CUSTOM_THEMES, JSON.stringify(list));
}

type Prefs = {
  themeId: string;
  cwdPanelOpen: boolean;
  customThemes: CustomTheme[];
  fontSize: number;
  setThemeId: (id: string) => void;
  setCwdPanelOpen: (v: boolean) => void;
  addCustomTheme: (t: CustomTheme) => void;
  updateCustomTheme: (id: string, t: CustomTheme) => void;
  removeCustomTheme: (id: string) => void;
  setFontSize: (n: number) => void;
};

export const usePrefs = create<Prefs>((set) => ({
  themeId: readStr(LS_THEME, "system"),
  cwdPanelOpen: readBool(LS_CWD_PANEL, true),
  customThemes: readCustomThemes(),
  fontSize: clampFont(readInt(LS_FONT_SIZE, 13)),
  setThemeId: (id) => {
    localStorage.setItem(LS_THEME, id);
    set({ themeId: id });
  },
  setCwdPanelOpen: (v) => {
    localStorage.setItem(LS_CWD_PANEL, v ? "1" : "0");
    set({ cwdPanelOpen: v });
  },
  addCustomTheme: (t) =>
    set((s) => {
      const next = [...s.customThemes, t];
      writeCustomThemes(next);
      return { customThemes: next };
    }),
  updateCustomTheme: (id, t) =>
    set((s) => {
      const next = s.customThemes.map((x) => (x.id === id ? t : x));
      writeCustomThemes(next);
      return { customThemes: next };
    }),
  removeCustomTheme: (id) =>
    set((s) => {
      const next = s.customThemes.filter((x) => x.id !== id);
      writeCustomThemes(next);
      return { customThemes: next };
    }),
  setFontSize: (n) => {
    const v = clampFont(n);
    localStorage.setItem(LS_FONT_SIZE, String(v));
    set({ fontSize: v });
  },
}));
