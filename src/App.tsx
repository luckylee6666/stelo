import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { TerminalView } from "./components/TerminalView";
import { ReconnectPanel } from "./components/ReconnectPanel";
import { ConnectingView } from "./components/ConnectingView";
import { CommandPalette } from "./components/CommandPalette";
import { AiPanel } from "./components/AiPanel";
import { AiManagerDialog } from "./components/AiManagerDialog";
import { HostKeyMismatchDialog } from "./components/HostKeyMismatchDialog";
import { DialogHost } from "./components/DialogHost";
import { useSessionStore } from "./stores/sessions";
import { loadAll, startAutoSave } from "./lib/persistence";
import { usePrefs } from "./stores/prefs";
import { findTheme, uiBaseFor } from "./lib/themes";
import { useT } from "./i18n";

function App() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const active = sessions.find((s) => s.id === activeId);

  const themeId = usePrefs((s) => s.themeId);
  const customThemes = usePrefs((s) => s.customThemes);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMgrOpen, setAiMgrOpen] = useState(false);

  useEffect(() => {
    const apply = () => {
      const t = findTheme(themeId, customThemes);
      document.documentElement.setAttribute("data-theme", uiBaseFor(t));
    };
    apply();
    // themeId === "system" 时监听系统配色变化实时切换
    if (themeId !== "system") return;
    const mm = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mm) return;
    const onChange = () => apply();
    mm.addEventListener?.("change", onChange);
    return () => mm.removeEventListener?.("change", onChange);
  }, [themeId, customThemes]);

  useEffect(() => {
    loadAll();
    return startAutoSave();
  }, []);

  // ⌘K 打开命令面板；⌘J 打开 AI 助手（避开 ⌘I，WebKit 里常被吃）
  // 用 capture 阶段，否则终端聚焦时 xterm 先吃掉 keydown
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((v) => !v);
      } else if (k === "j") {
        e.preventDefault();
        e.stopPropagation();
        setAiOpen((v) => !v);
      } else if (k === "=" || k === "+") {
        e.preventDefault();
        e.stopPropagation();
        const st = usePrefs.getState();
        st.setFontSize(st.fontSize + 1);
      } else if (k === "-" || k === "_") {
        e.preventDefault();
        e.stopPropagation();
        const st = usePrefs.getState();
        st.setFontSize(st.fontSize - 1);
      } else if (k === "0") {
        e.preventDefault();
        e.stopPropagation();
        usePrefs.getState().setFontSize(13);
      } else if (k === "t") {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("hyper:new-session"));
      } else if (k === "w") {
        e.preventDefault();
        e.stopPropagation();
        const st = useSessionStore.getState();
        if (st.activeId) st.disconnectSession(st.activeId);
      } else if (k === "f") {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("hyper:terminal-find"));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // 侧栏 🤖 AI 按钮通过自定义事件触发
  useEffect(() => {
    const openAi = () => setAiOpen(true);
    const openMgr = () => setAiMgrOpen(true);
    window.addEventListener("hyper:open-ai", openAi);
    window.addEventListener("hyper:open-ai-mgr", openMgr);
    return () => {
      window.removeEventListener("hyper:open-ai", openAi);
      window.removeEventListener("hyper:open-ai-mgr", openMgr);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-900 text-neutral-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <div className="relative min-h-0 flex-1">
          {active ? (
            active.kind === "ssh" && !active.backendId ? (
              active.status === "connecting" ? (
                <ConnectingView key={active.id} session={active} />
              ) : (
                <ReconnectPanel key={active.id} session={active} />
              )
            ) : (
              <TerminalView
                key={`${active.id}-${active.backendId ?? "local"}`}
                sessionId={active.id}
              />
            )
          ) : (
            <Welcome />
          )}
        </div>
        {aiOpen && (
          <AiPanel
            open={aiOpen}
            onClose={() => setAiOpen(false)}
            onOpenManager={() => {
              setAiMgrOpen(true);
            }}
          />
        )}
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
      {aiMgrOpen && <AiManagerDialog onClose={() => setAiMgrOpen(false)} />}
      <HostKeyMismatchDialog />
      <DialogHost />
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "rgb(23 23 23)",
            border: "1px solid rgb(64 64 64)",
            color: "rgb(229 229 229)",
            fontSize: "13px",
          },
          className: "shadow-2xl",
        }}
        closeButton
        richColors
      />
    </div>
  );
}

function Welcome() {
  const t = useT();
  const features: {
    icon: string;
    titleKey: string;
    descKey: string;
  }[] = [
    { icon: "✦", titleKey: "welcome.feature.ai.title", descKey: "welcome.feature.ai.desc" },
    { icon: "⇅", titleKey: "welcome.feature.sftp.title", descKey: "welcome.feature.sftp.desc" },
    { icon: "↯", titleKey: "welcome.feature.conn.title", descKey: "welcome.feature.conn.desc" },
    { icon: "◈", titleKey: "welcome.feature.sec.title", descKey: "welcome.feature.sec.desc" },
    { icon: "⌘", titleKey: "welcome.feature.cmd.title", descKey: "welcome.feature.cmd.desc" },
    { icon: "◐", titleKey: "welcome.feature.theme.title", descKey: "welcome.feature.theme.desc" },
  ];
  const secondary = [
    t("welcome.secondary.font"),
    t("welcome.secondary.tabs"),
    t("welcome.secondary.forward"),
    t("welcome.secondary.group"),
    t("welcome.secondary.creds"),
    t("welcome.secondary.themes"),
  ];
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 35%, rgba(99,102,241,0.12), transparent 70%)",
        }}
      />
      <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 select-none bg-clip-text text-[11rem] font-bold leading-none tracking-tighter text-transparent opacity-[0.04]"
        style={{ backgroundImage: "linear-gradient(135deg,#6366f1,#8b5cf6,#a78bfa)" }}
      >
        ✦
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <h1 className="bg-linear-to-br from-blue-400 via-indigo-500 to-violet-500 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
          Stelo
        </h1>
        <p className="mt-3 text-base text-neutral-400">
          {t("welcome.subtitle")}
        </p>

        <div className="mt-8 grid grid-cols-3 gap-2.5">
          {features.map((f) => (
            <div
              key={f.titleKey}
              className="group relative flex w-56 flex-col rounded-lg border border-neutral-800/80 bg-linear-to-b from-neutral-900/60 to-neutral-950/40 p-3.5 backdrop-blur-sm transition-all hover:border-indigo-500/30 hover:from-neutral-900/80"
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-300 transition-colors group-hover:bg-indigo-500/20">
                  {f.icon}
                </span>
                <span className="text-sm font-semibold text-neutral-100">
                  {t(f.titleKey)}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-neutral-500">
                {t(f.descKey)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-1.5">
          {secondary.map((label) => (
            <span
              key={label}
              className="rounded-full border border-neutral-800/80 bg-neutral-900/40 px-2.5 py-0.5 text-[11px] text-neutral-500"
            >
              {label}
            </span>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-neutral-500">
          <span className="flex items-center gap-1.5">
            <Kbd>⌘</Kbd>
            <Kbd>T</Kbd>
            <span>{t("welcome.kbd.newSession")}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
            <span>{t("welcome.kbd.palette")}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>⌘</Kbd>
            <Kbd>J</Kbd>
            <span>{t("welcome.kbd.ai")}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>⌘</Kbd>
            <Kbd>F</Kbd>
            <span>{t("welcome.kbd.find")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-neutral-700 bg-neutral-800/70 px-1.5 py-0.5 font-mono text-[11px] font-medium text-neutral-300 shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)]">
      {children}
    </kbd>
  );
}

export default App;
