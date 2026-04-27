import { create } from "zustand";
import zh from "./zh";
import en from "./en";
import type { Dict, Lang, LangSetting } from "./types";
import { LS, lsGet, lsSet } from "../lib/storage";
export { SUPPORTED_LANGS } from "./types";
export type { Lang, LangSetting } from "./types";

/** 所有语言字典集中在这里。新增语言时追加一条即可。 */
const DICTS: Record<Lang, Dict> = { zh, en };

function systemLang(): Lang {
  if (typeof navigator === "undefined") return "en";
  return /^zh\b/i.test(navigator.language) ? "zh" : "en";
}

function readSetting(): LangSetting {
  const v = lsGet(LS.lang, null);
  if (v === "zh" || v === "en" || v === "auto") return v;
  return "auto";
}

function resolve(setting: LangSetting): Lang {
  return setting === "auto" ? systemLang() : setting;
}

/** 字符串查字典；key 缺失时回落英文再回落 key 本身（dev 时能一眼看出漏翻）。 */
function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const raw = DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

type LangStore = {
  setting: LangSetting;
  lang: Lang;
  setLang: (v: LangSetting) => void;
};

export const useLang = create<LangStore>((set) => {
  const setting = readSetting();
  return {
    setting,
    lang: resolve(setting),
    setLang: (v) => {
      lsSet(LS.lang, v);
      set({ setting: v, lang: resolve(v) });
    },
  };
});

// "auto" 模式下监听系统语言变化——实际 navigator.language 变化很罕见（要改系统 Locale）
// 但 prefers-color-scheme 那种 media query 没有语言版本；只能在 app 启动时决定。
// 切 OS Locale 后重启 app 即可。无需额外监听。

/** Hook：组件里用。返回 `t(key, vars?)` 函数；lang 切换时组件自动重渲染。 */
export function useT() {
  const lang = useLang((s) => s.lang);
  return (key: string, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
}

/** 非 hook 场景的取字典：比如在 store action / 非 React 代码里。
 *  注意这是即时求值，lang 切换不会触发重渲染，只适合一次性读取。 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(useLang.getState().lang, key, vars);
}
