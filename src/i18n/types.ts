/** 支持的语言 id。新增语言时追加到这里即可（记得同步 DICTS 和语言菜单）。 */
export type Lang = "zh" | "en";

/** "auto" 表示跟随系统（navigator.language），存储时用此，运行时解析为具体 Lang。 */
export type LangSetting = Lang | "auto";

export const SUPPORTED_LANGS: { id: Lang; name: string; native: string }[] = [
  { id: "zh", name: "Chinese", native: "简体中文" },
  { id: "en", name: "English", native: "English" },
];

export type Dict = Record<string, string>;
