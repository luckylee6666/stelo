import { useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import { useLang, SUPPORTED_LANGS, useT, type LangSetting } from "../i18n";
import { cn } from "../lib/utils";

/** 语言切换下拉：置于侧栏底部，和 ThemeMenu 风格一致。 */
export function LangMenu() {
  const setting = useLang((s) => s.setting);
  const lang = useLang((s) => s.lang);
  const setLang = useLang((s) => s.setLang);
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const currentLabel =
    setting === "auto"
      ? `${t("lang.auto")} · ${t(`lang.${lang}`)}`
      : t(`lang.${lang}`);

  const pick = (v: LangSetting) => {
    setLang(v);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
        title={t("lang.menu")}
      >
        <Globe size={12} className="shrink-0 text-neutral-500" />
        <span className="truncate">{currentLabel}</span>
        <span className="ml-auto text-neutral-600">▾</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 overflow-auto rounded border border-neutral-700 bg-neutral-900 py-1 shadow-xl">
          <LangRow
            label={t("lang.auto")}
            selected={setting === "auto"}
            onClick={() => pick("auto")}
          />
          <div className="my-1 border-t border-neutral-800" />
          {SUPPORTED_LANGS.map((l) => (
            <LangRow
              key={l.id}
              label={l.native}
              selected={setting === l.id}
              onClick={() => pick(l.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LangRow({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-neutral-800",
        selected ? "bg-neutral-800 text-neutral-100" : "text-neutral-300",
      )}
    >
      <span className="flex-1 truncate">{label}</span>
      {selected && <Check size={11} className="text-blue-400" />}
    </button>
  );
}
