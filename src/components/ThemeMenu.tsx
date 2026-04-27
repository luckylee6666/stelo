import { useEffect, useRef, useState } from "react";
import { usePrefs } from "../stores/prefs";
import {
  BUILTIN_THEMES,
  SYSTEM_THEME_ID,
  findTheme,
  type CustomTheme,
} from "../lib/themes";
import { cn } from "../lib/utils";
import { ThemeEditor } from "./ThemeEditor";
import { useT } from "../i18n";

/** 内置主题显示时用 i18n key；自定义主题保持用户起的名。 */
function themeName(t: (k: string) => string, theme: { id: string; name: string; kind?: string }) {
  if (theme.kind === "custom") return theme.name;
  const key = `theme.${theme.id}`;
  const translated = t(key);
  return translated === key ? theme.name : translated;
}

export function ThemeMenu() {
  const themeId = usePrefs((s) => s.themeId);
  const setThemeId = usePrefs((s) => s.setThemeId);
  const customThemes = usePrefs((s) => s.customThemes);
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomTheme | null | "new">(null);
  const all = [...BUILTIN_THEMES, ...customThemes];
  const current =
    themeId === SYSTEM_THEME_ID
      ? findTheme(SYSTEM_THEME_ID, customThemes)
      : (all.find((t) => t.id === themeId) ?? BUILTIN_THEMES[0]);
  const isSystem = themeId === SYSTEM_THEME_ID;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
          title="切换终端主题"
        >
          <span
            className="h-3 w-3 shrink-0 rounded border border-neutral-700"
            style={{ background: current.xterm.background }}
          />
          <span className="truncate">
            {isSystem
              ? `${t("theme.menu.systemPrefix")} · ${themeName(t, current)}`
              : themeName(t, current)}
          </span>
          <span className="ml-auto text-neutral-600">▾</span>
        </button>
        {open && (
          <div className="absolute bottom-full left-0 right-0 mb-1 max-h-96 overflow-auto rounded border border-neutral-700 bg-neutral-900 py-1 shadow-xl">
            <div className="px-2 pt-1 pb-0.5 text-xs uppercase tracking-wider text-neutral-600">
              {t("theme.menu.auto")}
            </div>
            <div
              className={cn(
                "group flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-neutral-800",
                isSystem ? "bg-neutral-800 text-neutral-100" : "text-neutral-300",
              )}
            >
              <button
                onClick={() => {
                  setThemeId(SYSTEM_THEME_ID);
                  setOpen(false);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="flex h-3 w-3 shrink-0 overflow-hidden rounded border border-neutral-700">
                  <span className="h-full w-1/2 bg-neutral-950" />
                  <span className="h-full w-1/2 bg-neutral-100" />
                </span>
                <span className="flex-1 truncate">
                  {t("theme.menu.system")}
                </span>
                {isSystem && <span className="text-blue-400">✓</span>}
              </button>
            </div>
            <div className="mt-1 px-2 pt-1 pb-0.5 text-xs uppercase tracking-wider text-neutral-600">
              {t("theme.menu.builtin")}
            </div>
            {BUILTIN_THEMES.map((th) => (
              <ThemeRow
                key={th.id}
                theme={th}
                displayName={themeName(t, th)}
                selected={th.id === themeId}
                onSelect={() => {
                  setThemeId(th.id);
                  setOpen(false);
                }}
              />
            ))}
            {customThemes.length > 0 && (
              <>
                <div className="mt-1 px-2 pt-1 pb-0.5 text-[11px] uppercase tracking-wider text-neutral-600">
                  {t("theme.menu.custom")}
                </div>
                {customThemes.map((th) => (
                  <ThemeRow
                    key={th.id}
                    theme={th}
                    displayName={themeName(t, th)}
                    selected={th.id === themeId}
                    onSelect={() => {
                      setThemeId(th.id);
                      setOpen(false);
                    }}
                    onEdit={() => {
                      setOpen(false);
                      setEditing(th);
                    }}
                  />
                ))}
              </>
            )}
            <div className="mt-1 border-t border-neutral-800 pt-1">
              <button
                onClick={() => {
                  setOpen(false);
                  setEditing("new");
                }}
                className="w-full px-2 py-1.5 text-left text-xs text-blue-400 hover:bg-neutral-800 hover:text-blue-300"
              >
                {t("theme.menu.newCustom")}
              </button>
            </div>
          </div>
        )}
      </div>

      {editing !== null && (
        <ThemeEditor
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ThemeRow({
  theme,
  displayName,
  selected,
  onSelect,
  onEdit,
}: {
  theme: { id: string; name: string; xterm: { background?: string; foreground?: string } };
  displayName?: string;
  selected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-neutral-800",
        selected ? "bg-neutral-800 text-neutral-100" : "text-neutral-300",
      )}
    >
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className="h-3 w-3 shrink-0 rounded border border-neutral-700"
          style={{ background: theme.xterm.background ?? "#000" }}
        />
        <span className="flex-1 truncate">{displayName ?? theme.name}</span>
        {selected && <span className="text-blue-400">✓</span>}
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: theme.xterm.foreground ?? "#fff" }}
        />
      </button>
      {onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="edit"
          className="shrink-0 rounded px-1 text-neutral-500 opacity-0 hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100"
        >
          ✎
        </button>
      )}
    </div>
  );
}
