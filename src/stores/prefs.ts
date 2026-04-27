import { create } from "zustand";
import type { CustomTheme } from "../lib/themes";
import {
  LS,
  lsGet,
  lsGetBool,
  lsGetInt,
  lsGetJson,
  lsSet,
  lsSetJson,
} from "../lib/storage";

const MIN_FONT = 9;
const MAX_FONT = 28;
const clampFont = (n: number) => Math.max(MIN_FONT, Math.min(MAX_FONT, n));

function readCustomThemes(): CustomTheme[] {
  const list = lsGetJson<unknown>(LS.customThemes, []);
  if (!Array.isArray(list)) return [];
  return list.filter((t) => t && (t as { kind?: string }).kind === "custom") as CustomTheme[];
}

function writeCustomThemes(list: CustomTheme[]) {
  lsSetJson(LS.customThemes, list);
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
  themeId: lsGet(LS.themeId, "system"),
  cwdPanelOpen: lsGetBool(LS.cwdPanelOpen, true),
  customThemes: readCustomThemes(),
  fontSize: clampFont(lsGetInt(LS.fontSize, 13)),
  setThemeId: (id) => {
    lsSet(LS.themeId, id);
    set({ themeId: id });
  },
  setCwdPanelOpen: (v) => {
    lsSet(LS.cwdPanelOpen, v);
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
    lsSet(LS.fontSize, v);
    set({ fontSize: v });
  },
}));
