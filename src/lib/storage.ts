/**
 * 集中所有 localStorage key 和类型化 getter/setter。
 * 之前各文件 LS_* 常量散落，新增 key 没法一目了然，且有 typo 风险。
 *
 * 用法：
 *   import { LS, lsGet, lsSet, lsRemove } from "./storage";
 *   const themeId = lsGet(LS.themeId, "system");
 *   lsSet(LS.themeId, "dracula");
 *
 * 所有 key 都以 hypershell. 前缀（与 ConfigBackupDialog 的 export 过滤一致）。
 */

export const LS = {
  // 主题与字体
  themeId: "hypershell.themeId",
  customThemes: "hypershell.customThemes",
  fontSize: "hypershell.fontSize",

  // 面板状态
  cwdPanelOpen: "hypershell.cwdPanelOpen",
  groupsCollapsed: "hypershell.groupsCollapsed",

  // AI
  aiActiveId: "hypershell.aiActiveId",
  aiAgentMode: "hypershell.aiAgentMode",
  aiStrictRedact: "hypershell.aiStrictRedact",

  // i18n
  lang: "hypershell.lang",
} as const;

export type LsKey = (typeof LS)[keyof typeof LS];

/** 获取字符串 key；不存在或类型错误 → 返回 fallback。 */
export function lsGet(key: LsKey, fallback: string): string;
export function lsGet(key: LsKey, fallback: null): string | null;
export function lsGet(key: LsKey, fallback: string | null = null): string | null {
  try {
    const v = localStorage.getItem(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function lsGetBool(key: LsKey, fallback: boolean): boolean {
  const v = lsGet(key, null);
  if (v === null) return fallback;
  return v === "1" || v === "true";
}

export function lsGetInt(key: LsKey, fallback: number): number {
  const v = lsGet(key, null);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function lsGetJson<T>(key: LsKey, fallback: T): T {
  const v = lsGet(key, null);
  if (v === null) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export function lsSet(key: LsKey, value: string | number | boolean): void {
  try {
    let v: string;
    if (typeof value === "boolean") v = value ? "1" : "0";
    else v = String(value);
    localStorage.setItem(key, v);
  } catch {
    /* quota / disabled localStorage：静默 */
  }
}

export function lsSetJson(key: LsKey, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 静默 */
  }
}

export function lsRemove(key: LsKey): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 静默 */
  }
}
