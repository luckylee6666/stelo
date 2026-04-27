import { useMemo, useState } from "react";
import type { ITheme } from "@xterm/xterm";
import {
  BUILTIN_THEMES,
  THEME_FIELDS,
  type CustomTheme,
  type TerminalTheme,
} from "../lib/themes";
import { usePrefs } from "../stores/prefs";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  initial: CustomTheme | null;
  onClose: () => void;
};

let counter = 0;
const newId = () => `custom-${Date.now()}-${counter++}`;

function sanitizeHex(v: string): string {
  const m = v.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (!m) return v;
  const hex = m[1];
  if (hex.length === 3) {
    return `#${hex
      .split("")
      .map((c) => c + c)
      .join("")}`;
  }
  return `#${hex}`;
}

export function ThemeEditor({ initial, onClose }: Props) {
  const addCustomTheme = usePrefs((s) => s.addCustomTheme);
  const updateCustomTheme = usePrefs((s) => s.updateCustomTheme);
  const removeCustomTheme = usePrefs((s) => s.removeCustomTheme);
  const setThemeId = usePrefs((s) => s.setThemeId);

  const [name, setName] = useState(initial?.name ?? "我的主题");
  const [baseId, setBaseId] = useState(initial?.baseId ?? "neutral");
  const [xterm, setXterm] = useState<ITheme>(
    initial?.xterm ?? BUILTIN_THEMES[0].xterm,
  );
  const [pendingDelete, setPendingDelete] = useState(false);

  const setColor = (key: keyof ITheme, value: string) =>
    setXterm((t) => ({ ...t, [key]: value }));

  const applyBase = (id: string) => {
    setBaseId(id);
    const b = BUILTIN_THEMES.find((t) => t.id === id);
    if (b && !initial) setXterm({ ...b.xterm });
  };

  const copyFromBase = () => {
    const b = BUILTIN_THEMES.find((t) => t.id === baseId);
    if (b) setXterm({ ...b.xterm });
  };

  const save = () => {
    if (!name.trim()) return;
    const theme: CustomTheme = {
      id: initial?.id ?? newId(),
      name: name.trim(),
      kind: "custom",
      baseId,
      xterm,
    };
    if (initial) updateCustomTheme(initial.id, theme);
    else {
      addCustomTheme(theme);
      setThemeId(theme.id);
    }
    onClose();
  };

  const preview = useMemo<TerminalTheme>(
    () => ({ id: "preview", name, kind: "custom", baseId, xterm }),
    [name, baseId, xterm],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[620px] w-[880px] flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              {initial ? "编辑主题" : "新建主题"}
            </h2>
            <p className="text-xs text-neutral-500">
              自定义终端 24 色，UI 配色沿用选择的"基础主题"
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-[420px] shrink-0 flex-col overflow-auto border-r border-neutral-800 p-4">
            <label className="mb-3 block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
                名称
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
              />
            </label>

            <div className="mb-3 flex gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
                  基础主题（UI 配色）
                </span>
                <select
                  value={baseId}
                  onChange={(e) => applyBase(e.target.value)}
                  className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
                >
                  {BUILTIN_THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={copyFromBase}
                title="把基础主题的颜色复制到下方色盘"
                className="self-end rounded border border-neutral-700 px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                从基础复制
              </button>
            </div>

            <div className="grid grid-cols-1 gap-1">
              {THEME_FIELDS.map((f) => (
                <ColorRow
                  key={f.key}
                  label={f.label}
                  value={(xterm[f.key] as string) ?? "#000000"}
                  onChange={(v) => setColor(f.key, v)}
                />
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-neutral-800 px-5 py-2 text-xs uppercase tracking-wider text-neutral-500">
              预览
            </div>
            <TerminalPreview theme={preview} />
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-neutral-800 px-5 py-3">
          {initial ? (
            <button
              onClick={() => setPendingDelete(true)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              删除此主题
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              取消
            </button>
            <button
              onClick={save}
              disabled={!name.trim()}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              保存
            </button>
          </div>
        </div>
      </div>

      {pendingDelete && initial && (
        <ConfirmDialog
          title="删除主题"
          message={`确认删除自定义主题"${initial.name}"？`}
          confirmText="删除"
          danger
          onConfirm={() => {
            removeCustomTheme(initial.id);
            setThemeId("neutral");
            setPendingDelete(false);
            onClose();
          }}
          onCancel={() => setPendingDelete(false)}
        />
      )}
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-sm">
      <span className="w-16 shrink-0 text-xs text-neutral-400">
        {label}
      </span>
      <input
        type="color"
        value={value.length === 7 ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-10 shrink-0 rounded border border-neutral-700 bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(sanitizeHex(e.target.value))}
        className="w-24 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-200 outline-none focus:border-blue-500"
      />
    </div>
  );
}

function TerminalPreview({ theme }: { theme: TerminalTheme }) {
  const x = theme.xterm;
  const color = (k: keyof ITheme) => (x[k] as string) ?? "#ffffff";
  return (
    <div
      className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[13px] leading-relaxed"
      style={{ background: color("background"), color: color("foreground") }}
    >
      <div>
        <span style={{ color: color("green") }}>user@host</span>
        <span style={{ color: color("foreground") }}>:</span>
        <span style={{ color: color("blue") }}>~/projects</span>
        <span style={{ color: color("foreground") }}>$ </span>
        ls -la
      </div>
      <div>
        <span style={{ color: color("brightBlack") }}>
          drwxr-xr-x 3 user staff 96
        </span>{" "}
        <span style={{ color: color("blue") }}>src</span>
      </div>
      <div>
        <span style={{ color: color("brightBlack") }}>
          -rw-r--r-- 1 user staff 1024
        </span>{" "}
        README.md
      </div>
      <div>
        <span style={{ color: color("brightBlack") }}>
          -rwxr-xr-x 1 user staff 2048
        </span>{" "}
        <span style={{ color: color("green") }}>run.sh</span>
      </div>
      <div className="mt-3">
        <span style={{ color: color("green") }}>✓</span>{" "}
        <span style={{ color: color("brightGreen") }}>build</span> succeeded
      </div>
      <div>
        <span style={{ color: color("red") }}>✗</span>{" "}
        <span style={{ color: color("brightRed") }}>error</span>{" "}
        <span style={{ color: color("foreground") }}>something went wrong</span>
      </div>
      <div>
        <span style={{ color: color("yellow") }}>⚠</span>{" "}
        <span style={{ color: color("brightYellow") }}>warning</span> deprecated
        api
      </div>
      <div className="mt-3">
        <span style={{ color: color("magenta") }}>function </span>
        <span style={{ color: color("brightBlue") }}>greet</span>(
        <span style={{ color: color("yellow") }}>name</span>){" "}
        <span style={{ color: color("magenta") }}>{`{ `}</span>
        <span style={{ color: color("cyan") }}>return</span>{" "}
        <span style={{ color: color("brightGreen") }}>
          `Hello, ${"${name}"}!`
        </span>
        <span style={{ color: color("magenta") }}>{` }`}</span>
      </div>
      <div className="mt-4 flex gap-1 text-xs">
        {(["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const).map(
          (k) => (
            <span
              key={k}
              className="inline-block h-4 w-4 border border-neutral-700"
              style={{ background: color(k) }}
              title={k}
            />
          ),
        )}
      </div>
      <div className="mt-1 flex gap-1 text-xs">
        {(
          [
            "brightBlack",
            "brightRed",
            "brightGreen",
            "brightYellow",
            "brightBlue",
            "brightMagenta",
            "brightCyan",
            "brightWhite",
          ] as const
        ).map((k) => (
          <span
            key={k}
            className="inline-block h-4 w-4 border border-neutral-700"
            style={{ background: color(k) }}
            title={k}
          />
        ))}
      </div>
      <div className="mt-3">
        <span
          className="inline-block h-[1.2em] w-2"
          style={{ background: color("cursor") }}
        />
      </div>
    </div>
  );
}
