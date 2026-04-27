import type { ITheme } from "@xterm/xterm";

export type BuiltinTheme = {
  id: string;
  name: string;
  kind: "builtin";
  isDark: boolean;
  xterm: ITheme;
};

export type CustomTheme = {
  id: string;
  name: string;
  kind: "custom";
  baseId: string; // UI 基础配色，取自某个 builtin
  xterm: ITheme;
};

export type TerminalTheme = BuiltinTheme | CustomTheme;

export const BUILTIN_THEMES: BuiltinTheme[] = [
  {
    id: "neutral",
    name: "Neutral 暗色",
    kind: "builtin",
    isDark: true,
    xterm: {
      background: "#171717",
      foreground: "#e5e5e5",
      cursor: "#a3a3a3",
      cursorAccent: "#171717",
      selectionBackground: "#3b3b3b",
      black: "#1d1d1d",
      red: "#ff6b6b",
      green: "#51cf66",
      yellow: "#fcc419",
      blue: "#4dabf7",
      magenta: "#cc5de8",
      cyan: "#3bc9db",
      white: "#e5e5e5",
      brightBlack: "#525252",
      brightRed: "#ff8787",
      brightGreen: "#69db7c",
      brightYellow: "#ffd43b",
      brightBlue: "#74c0fc",
      brightMagenta: "#da77f2",
      brightCyan: "#66d9e8",
      brightWhite: "#f5f5f5",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    kind: "builtin",
    isDark: true,
    xterm: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      cursorAccent: "#282a36",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    kind: "builtin",
    isDark: true,
    xterm: {
      background: "#002b36",
      foreground: "#93a1a1",
      cursor: "#93a1a1",
      cursorAccent: "#002b36",
      selectionBackground: "#073642",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    kind: "builtin",
    isDark: true,
    xterm: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      cursorAccent: "#1a1b26",
      selectionBackground: "#33467c",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    kind: "builtin",
    isDark: true,
    xterm: {
      background: "#282828",
      foreground: "#ebdbb2",
      cursor: "#ebdbb2",
      cursorAccent: "#282828",
      selectionBackground: "#504945",
      black: "#282828",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightBlack: "#928374",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    kind: "builtin",
    isDark: false,
    xterm: {
      background: "#fdf6e3",
      foreground: "#657b83",
      cursor: "#657b83",
      cursorAccent: "#fdf6e3",
      selectionBackground: "#eee8d5",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  {
    id: "stelo-light",
    name: "Stelo Light",
    kind: "builtin",
    isDark: false,
    xterm: {
      background: "#ffffff",
      foreground: "#1e293b",
      cursor: "#3b82f6",
      cursorAccent: "#ffffff",
      selectionBackground: "#bfdbfe",
      black: "#24292e",
      red: "#d73a49",
      green: "#28a745",
      yellow: "#b08800",
      blue: "#0366d6",
      magenta: "#6f42c1",
      cyan: "#0598bc",
      white: "#6a737d",
      brightBlack: "#959da5",
      brightRed: "#cb2431",
      brightGreen: "#22863a",
      brightYellow: "#b08800",
      brightBlue: "#005cc5",
      brightMagenta: "#5a32a3",
      brightCyan: "#3192aa",
      brightWhite: "#1e293b",
    },
  },
  {
    id: "stelo-dark",
    name: "Stelo Dark",
    kind: "builtin",
    isDark: true,
    xterm: {
      background: "#000000",
      foreground: "#e5e5e5",
      cursor: "#60a5fa",
      cursorAccent: "#000000",
      selectionBackground: "#1e3a8a",
      black: "#0a0a0a",
      red: "#ff6b6b",
      green: "#51cf66",
      yellow: "#fcc419",
      blue: "#4dabf7",
      magenta: "#cc5de8",
      cyan: "#3bc9db",
      white: "#d4d4d4",
      brightBlack: "#525252",
      brightRed: "#ff8787",
      brightGreen: "#69db7c",
      brightYellow: "#ffd43b",
      brightBlue: "#74c0fc",
      brightMagenta: "#da77f2",
      brightCyan: "#66d9e8",
      brightWhite: "#ffffff",
    },
  },
];

/** 特殊 id："system" 表示跟随操作系统明暗色（prefers-color-scheme）。 */
export const SYSTEM_THEME_ID = "system";

/** 系统深色时回退到这个；浅色时回退到另外一个。 */
const SYSTEM_DARK_FALLBACK = "stelo-dark";
const SYSTEM_LIGHT_FALLBACK = "stelo-light";

function prefersLight(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function findTheme(
  id: string | null | undefined,
  customs: CustomTheme[] = [],
): TerminalTheme {
  const all = [...BUILTIN_THEMES, ...customs];
  if (id === SYSTEM_THEME_ID) {
    const targetId = prefersLight() ? SYSTEM_LIGHT_FALLBACK : SYSTEM_DARK_FALLBACK;
    return all.find((t) => t.id === targetId) ?? BUILTIN_THEMES[0];
  }
  return all.find((t) => t.id === id) ?? BUILTIN_THEMES[0];
}

export function uiBaseFor(t: TerminalTheme): string {
  return t.kind === "custom" ? t.baseId : t.id;
}

export const THEME_FIELDS: { key: keyof ITheme; label: string }[] = [
  { key: "background", label: "背景" },
  { key: "foreground", label: "前景" },
  { key: "cursor", label: "光标" },
  { key: "cursorAccent", label: "光标对比" },
  { key: "selectionBackground", label: "选中背景" },
  { key: "black", label: "黑" },
  { key: "red", label: "红" },
  { key: "green", label: "绿" },
  { key: "yellow", label: "黄" },
  { key: "blue", label: "蓝" },
  { key: "magenta", label: "品红" },
  { key: "cyan", label: "青" },
  { key: "white", label: "白" },
  { key: "brightBlack", label: "亮黑" },
  { key: "brightRed", label: "亮红" },
  { key: "brightGreen", label: "亮绿" },
  { key: "brightYellow", label: "亮黄" },
  { key: "brightBlue", label: "亮蓝" },
  { key: "brightMagenta", label: "亮品红" },
  { key: "brightCyan", label: "亮青" },
  { key: "brightWhite", label: "亮白" },
];
