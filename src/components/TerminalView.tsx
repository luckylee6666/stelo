import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSessionStore, type Session } from "../stores/sessions";
import { StatusBar } from "./StatusBar";
import { UploadDialog } from "./UploadDialog";
import { CwdPanel } from "./CwdPanel";
import { FileEditor } from "./FileEditor";
import { ImagePreview, isImagePath } from "./ImagePreview";
import { OfficePreview, isOfficePath } from "./OfficePreview";
import { useState } from "react";
import { usePrefs } from "../stores/prefs";
import { findTheme } from "../lib/themes";
import { confirm } from "../lib/dialog";

const termRefByKey = new Map<string, XTerm>();
const fitRefByKey = new Map<string, FitAddon>();
const searchRefByKey = new Map<string, SearchAddon>();
const webglRefByKey = new Map<string, WebglAddon>();

function decodeB64(b64: string): Uint8Array {
  const raw = atob(b64);
  const u8 = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
  return u8;
}

export function TerminalView({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const session = useSessionStore((s) =>
    s.sessions.find((x) => x.id === sessionId),
  );
  const [dropFiles, setDropFiles] = useState<string[]>([]);
  const cwdOpen = usePrefs((s) => s.cwdPanelOpen);
  const setCwdOpen = usePrefs((s) => s.setCwdPanelOpen);
  const themeId = usePrefs((s) => s.themeId);
  const customThemes = usePrefs((s) => s.customThemes);
  const fontSize = usePrefs((s) => s.fontSize);
  const [editFile, setEditFile] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewOffice, setPreviewOffice] = useState<string | null>(null);

  useEffect(() => {
    if (session?.kind !== "ssh" || !session.backendId) return;
    let un: UnlistenFn | null = null;
    listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
      const paths = e.payload?.paths ?? [];
      if (paths.length > 0) setDropFiles(paths);
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, [session?.kind, session?.backendId]);

  // AiPanel 上传完成后要求打开右侧文件面板（并让 CwdPanel 跳到上传目标路径）
  useEffect(() => {
    const onOpenPanel = (e: Event) => {
      const ce = e as CustomEvent<{ backendId: string }>;
      if (ce.detail?.backendId === session?.backendId) {
        setCwdOpen(true);
      }
    };
    window.addEventListener("hyper:open-file-panel", onOpenPanel);
    return () =>
      window.removeEventListener("hyper:open-file-panel", onOpenPanel);
  }, [session?.backendId, setCwdOpen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const session: Session | undefined = useSessionStore
      .getState()
      .sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const term = new XTerm({
      fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: usePrefs.getState().fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "bar",
      theme: findTheme(themeId, customThemes).xterm,
      allowProposedApi: true,
      scrollback: 10000,
    });
    // 暴露 term 到 ref 供主题 / 字体热切换
    termRefByKey.set(sessionId, term);

    const fit = new FitAddon();
    fitRefByKey.set(sessionId, fit);
    term.loadAddon(fit);
    const searchAddon = new SearchAddon();
    searchRefByKey.set(sessionId, searchAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(new WebLinksAddon());

    term.open(container);

    try {
      const webgl = new WebglAddon();
      term.loadAddon(webgl);
      webglRefByKey.set(sessionId, webgl);
    } catch {
      /* 回退到 canvas */
    }
    fit.fit();

    // OSC 7: file://host/path → 同步 cwd
    // 安全：拒绝包含 .. 或控制字符的路径，防恶意服务器伪造 cwd 误导后续 SFTP 操作
    term.parser.registerOscHandler(7, (data) => {
      const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
      if (m) {
        const raw = m[1];
        try {
          const decoded = decodeURIComponent(raw);
          if (decoded.includes("..") || /[\x00-\x1f]/.test(decoded)) {
            return true; // 静默丢弃可疑路径
          }
          useSessionStore.getState().setCwd(sessionId, decoded);
        } catch {
          if (!raw.includes("..")) {
            useSessionStore.getState().setCwd(sessionId, raw);
          }
        }
      }
      return true;
    });

    // OSC 52（剪贴板写入）/ OSC 51（输入伪造）：远端 SSH server 不应主动写用户剪贴板，
    // 这会被恶意服务器用来污染剪贴板（粘贴攻击）。整个吞掉。
    // 注册 handler 返回 true 表示"已处理"，xterm 不再做默认动作。
    term.parser.registerOscHandler(52, () => true);
    term.parser.registerOscHandler(51, () => true);

    const unlisten: UnlistenFn[] = [];
    let disposed = false;

    // 注意：组件 unmount 不发 ssh_disconnect。
    // React StrictMode 会 mount→cleanup→mount，若此处断开会把真实后端 session 清掉。
    // 只有用户在 Sidebar 点 × 关闭会话时才断开（见 stores/sessions.ts closeSession）。

    if (session.kind === "ssh" && session.backendId) {
      const bid = session.backendId;

      const now = new Date().toLocaleTimeString();
      const target = `${session.user}@${session.host}${
        session.port && session.port !== 22 ? `:${session.port}` : ""
      }`;
      term.writeln(
        `\x1b[32m✓\x1b[0m \x1b[1m已连接到 ${target}\x1b[0m \x1b[2m(${now})\x1b[0m`,
      );
      term.writeln(
        `\x1b[2m  session: ${bid.slice(0, 8)}…  认证: ${
          session.authMode === "private_key" ? "密钥" : "密码"
        }\x1b[0m`,
      );
      term.writeln("");

      listen<string>(`ssh:data:${bid}`, (e) => {
        if (!disposed) term.write(decodeB64(e.payload));
      }).then((u) => unlisten.push(u));

      let stopSending = false;
      let reconnectPending = false;
      let reconnecting = false;

      const triggerReconnect = () => {
        if (reconnecting) return;
        reconnecting = true;
        reconnectPending = false;
        if (!disposed) term.writeln("\r\n\x1b[36m正在重连…\x1b[0m");
        // 清掉 backendId，让 autoConnect 不会因为已连接早退
        useSessionStore.setState((state) => ({
          sessions: state.sessions.map((x) =>
            x.id === sessionId ? { ...x, backendId: undefined } : x,
          ),
        }));
        const fresh = useSessionStore
          .getState()
          .sessions.find((x) => x.id === sessionId);
        if (!fresh) return;
        // 注意：autoConnect 成功后会 attachBackend，新 backendId 触发 App.tsx 用新 key 重挂
        // TerminalView，旧的会 unmount -> disposed = true，下面 writeln 是 no-op。
        // 失败时 status=error，渲染切到 ReconnectPanel 显示 errorMsg，无需在这里 writeln。
        import("../lib/autoConnect").then(({ autoConnect }) => {
          autoConnect(fresh);
        });
      };

      const markBroken = (reason: string, logHeader: string) => {
        if (stopSending) return; // 幂等
        stopSending = true;
        reconnectPending = true;
        if (disposed) return;
        term.writeln(`\r\n\x1b[33m${logHeader}\x1b[0m`);
        if (reason) term.writeln(`\x1b[2m${reason}\x1b[0m`);
        term.writeln("\x1b[2m按回车自动重连…\x1b[0m");
      };

      listen<{ reason: string }>(`ssh:closed:${bid}`, (e) => {
        if (disposed) return;
        const reason = e.payload.reason ?? "";
        useSessionStore.getState().setStatus(sessionId, "closed");
        if (reason.includes("closed by user")) {
          // 用户主动断开，不提示重连
          term.writeln(`\r\n\x1b[33m[连接已关闭: ${reason}]\x1b[0m`);
        } else {
          markBroken(reason, `[连接已关闭: ${reason}]`);
        }
      }).then((u) => unlisten.push(u));

      // 立即把真实终端尺寸同步到远端 PTY
      invoke("ssh_resize", {
        sessionId: bid,
        cols: term.cols,
        rows: term.rows,
      }).catch(() => {});

      let cmdBuf = "";
      let inEscape = false;
      const recordBuffer = () => {
        const c = cmdBuf.trim();
        if (c.length >= 2) {
          import("../stores/history").then(({ useHistoryStore }) => {
            useHistoryStore.getState().record(c);
          });
        }
        cmdBuf = "";
      };
      term.onData((d) => {
        // 连接已失效，按回车触发自动重连
        if (stopSending) {
          if (reconnectPending && (d.includes("\r") || d.includes("\n"))) {
            triggerReconnect();
          }
          return;
        }
        // 粘贴多行确认（bracketed paste 序列：\x1b[200~ ... \x1b[201~）
        const pasteMatch = d.match(
          /\x1b\[200~([\s\S]*?)\x1b\[201~/,
        );
        if (pasteMatch) {
          const pasted = pasteMatch[1];
          const lineCount = pasted.split(/\r\n|\r|\n/).length;
          if (lineCount > 3) {
            const preview = pasted
              .split(/\r\n|\r|\n/)
              .slice(0, 6)
              .join("\n") + (lineCount > 6 ? `\n... (还有 ${lineCount - 6} 行)` : "");
            // async 流：等用户确认期间挂起这次输入；不确认就 return 不发送
            (async () => {
              const ok = await confirm({
                title: `粘贴 ${lineCount} 行到终端`,
                message: "多行粘贴可能误操作（如把命令直接执行）。请检查内容后再确认。",
                preview,
                confirmText: "粘贴",
              });
              if (!ok) return;
              await sendDataAndSync(d);
            })();
            return;
          }
        }
        sendDataAndSync(d);
      });

      // 把"记命令历史 + invoke ssh_send + syncInput 广播"打包，可被 paste-confirmed 路径复用
      async function sendDataAndSync(d: string) {
        // 追踪用户输入，回车时记命令到历史
        for (const ch of d) {
          if (inEscape) {
            if ((ch >= "@" && ch <= "~") || ch === "\x07") {
              inEscape = false;
            }
            continue;
          }
          if (ch === "\x1b") {
            inEscape = true;
          } else if (ch === "\r" || ch === "\n") {
            recordBuffer();
          } else if (ch === "\x7f" || ch === "\b") {
            cmdBuf = cmdBuf.slice(0, -1);
          } else if (ch === "\x03" || ch === "\x15") {
            cmdBuf = "";
          } else if (ch >= " ") {
            cmdBuf += ch;
          }
        }
        invoke("ssh_send", { sessionId: bid, data: d }).catch((err) => {
          const msg = String(err);
          if (
            msg.includes("session not found") ||
            msg.includes("session task ended")
          ) {
            useSessionStore.getState().setStatus(sessionId, "closed", msg);
            markBroken(msg, "[连接已失效]");
          } else {
            term.writeln(`\r\n\x1b[31m发送失败: ${msg}\x1b[0m`);
          }
        });

        // 多会话同步输入：当前 session 勾了 syncInput 时，广播到其他 syncInput 会话
        const me = useSessionStore
          .getState()
          .sessions.find((x) => x.id === sessionId);
        if (me?.syncInput) {
          // 安全护栏：粘贴长串大概率是密码/token/配置块，广播很危险，弹确认。
          const pasteMatchSync = d.match(/\x1b\[200~([\s\S]*?)\x1b\[201~/);
          let allowSync = true;
          if (pasteMatchSync) {
            const body = pasteMatchSync[1];
            if (body.length > 20) {
              const preview = body.slice(0, 200).replace(/\r/g, "");
              const targetCount = useSessionStore
                .getState()
                .sessions.filter(
                  (x) => x.syncInput && x.backendId && x.kind === "ssh",
                ).length;
              allowSync = await confirm({
                title: "广播粘贴内容到所有同步会话？",
                message: `多会话同步输入已开启，这段粘贴会同时发往 ${targetCount} 个会话。如果是密码 / API Key / token，请取消。`,
                preview,
                confirmText: "广播",
                warn: true,
              });
            }
          }
          if (allowSync) {
            const others = useSessionStore
              .getState()
              .sessions.filter(
                (x) =>
                  x.id !== sessionId &&
                  x.syncInput &&
                  x.backendId &&
                  x.kind === "ssh",
              );
            for (const o of others) {
              invoke("ssh_send", {
                sessionId: o.backendId,
                data: d,
              }).catch((e) => {
                // 同步广播失败要让用户知道某条 session 有问题，但不阻塞主流
                console.warn(`syncInput 广播到 ${o.id} 失败:`, e);
              });
            }
          }
        }
      }
    } else {
      // 本地演示模式：回显
      term.writeln("\x1b[1;36m Stelo \x1b[0m\x1b[2m 本地回显模式\x1b[0m");
      term.writeln("\x1b[2m 可用命令：help / about / clear\x1b[0m");
      term.writeln("");
      term.write("\x1b[32m➜\x1b[0m \x1b[36m~\x1b[0m ");
      let buf = "";
      term.onData((d) => {
        for (const ch of d) {
          if (ch === "\r") {
            term.write("\r\n");
            const cmd = buf.trim();
            if (cmd === "clear") term.clear();
            else if (cmd === "help")
              term.writeln("可用命令：help, clear, about");
            else if (cmd === "about")
              term.writeln("Stelo — Tauri + Rust + xterm.js");
            else if (cmd.length > 0)
              term.writeln(`\x1b[33m[echo]\x1b[0m ${cmd}`);
            buf = "";
            term.write("\x1b[32m➜\x1b[0m \x1b[36m~\x1b[0m ");
          } else if (ch === "\x7f") {
            if (buf.length > 0) {
              buf = buf.slice(0, -1);
              term.write("\b \b");
            }
          } else if (ch >= " ") {
            buf += ch;
            term.write(ch);
          }
        }
      });
    }

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* noop */
      }
      if (session.kind === "ssh" && session.backendId) {
        invoke("ssh_resize", {
          sessionId: session.backendId,
          cols: term.cols,
          rows: term.rows,
        }).catch(() => {});
      }
    });
    ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      for (const fn of unlisten) fn();
      unlisten.length = 0;
      termRefByKey.delete(sessionId);
      fitRefByKey.delete(sessionId);
      searchRefByKey.delete(sessionId);
      webglRefByKey.delete(sessionId);
      term.dispose();
    };
  }, [sessionId]);

  // 主题热切换：themeId 直接改时触发；themeId="system" 时监听系统明暗色变化也触发
  useEffect(() => {
    const applyTheme = () => {
      const t = termRefByKey.get(sessionId);
      if (!t) return;
      const xt = findTheme(themeId, customThemes).xterm;
      t.options.theme = { ...xt };
      // WebGL renderer 把字符纹理缓存到 GPU，必须清 atlas 才会用新主题色重绘
      try {
        webglRefByKey.get(sessionId)?.clearTextureAtlas();
      } catch {
        /* noop */
      }
      try {
        t.refresh(0, t.rows - 1);
      } catch {
        /* noop */
      }
    };
    applyTheme();
    if (themeId !== "system") return;
    const mm = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mm) return;
    const onChange = () => applyTheme();
    mm.addEventListener?.("change", onChange);
    return () => mm.removeEventListener?.("change", onChange);
  }, [themeId, sessionId, customThemes]);

  // 字体大小热切换 + 重新适配
  useEffect(() => {
    const t = termRefByKey.get(sessionId);
    if (!t) return;
    t.options.fontSize = fontSize;
    setTimeout(() => {
      try {
        fitRefByKey.get(sessionId)?.fit();
      } catch {
        /* noop */
      }
    }, 10);
  }, [fontSize, sessionId]);

  // 接受来自 AI 面板 / 快捷指令的焦点请求
  useEffect(() => {
    const handler = () => {
      const t = termRefByKey.get(sessionId);
      try {
        t?.focus();
      } catch {
        /* noop */
      }
    };
    window.addEventListener("hyper:focus-terminal", handler);
    return () => window.removeEventListener("hyper:focus-terminal", handler);
  }, [sessionId]);

  const showPanel =
    cwdOpen && session?.kind === "ssh" && !!session.backendId && !!session.cwd;
  const themeBg = findTheme(themeId, customThemes).xterm.background ?? "#171717";

  return (
    <div className="flex h-full w-full flex-col">
      {session?.kind === "ssh" && session.backendId && (
        <StatusBar
          backendId={session.backendId}
          cwd={session.cwd}
          panelOpen={cwdOpen}
          onCwdClick={() => setCwdOpen(!cwdOpen)}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <div
          className="relative min-w-0 flex-1"
          style={{ background: themeBg }}
        >
          <div ref={containerRef} className="h-full px-2 pt-1" />
          <TerminalFind sessionId={sessionId} />
        </div>
        {showPanel && session?.backendId && session.cwd && (
          <CwdPanel
            backendId={session.backendId}
            cwd={session.cwd}
            onClose={() => setCwdOpen(false)}
            onOpenFile={(p) => {
              if (isImagePath(p)) setPreviewImage(p);
              else if (isOfficePath(p)) setPreviewOffice(p);
              else setEditFile(p);
            }}
          />
        )}
      </div>
      {editFile && session?.backendId && (
        <FileEditor
          backendId={session.backendId}
          remotePath={editFile}
          onClose={() => setEditFile(null)}
        />
      )}
      {previewImage && session?.backendId && (
        <ImagePreview
          backendId={session.backendId}
          remotePath={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      )}
      {previewOffice && session?.backendId && (
        <OfficePreview
          backendId={session.backendId}
          remotePath={previewOffice}
          onClose={() => setPreviewOffice(null)}
        />
      )}
      {dropFiles.length > 0 && session?.backendId && (
        <UploadDialog
          backendId={session.backendId}
          defaultRemote={session.cwd ?? "~/"}
          files={dropFiles}
          onClose={() => setDropFiles([])}
        />
      )}
    </div>
  );
}

function TerminalFind({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onFind = () => {
      setOpen(true);
      setTimeout(() => inputRef.current?.select(), 30);
    };
    window.addEventListener("hyper:terminal-find", onFind);
    return () => window.removeEventListener("hyper:terminal-find", onFind);
  }, []);

  const opts = { caseSensitive, wholeWord };

  const findNext = () => {
    if (!query) return;
    searchRefByKey.get(sessionId)?.findNext(query, opts);
  };
  const findPrev = () => {
    if (!query) return;
    searchRefByKey.get(sessionId)?.findPrevious(query, opts);
  };
  const close = () => {
    setOpen(false);
    searchRefByKey.get(sessionId)?.clearDecorations();
    termRefByKey.get(sessionId)?.focus();
  };

  if (!open) return null;
  return (
    <div className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900/95 px-2 py-1 shadow-lg backdrop-blur">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // decorate matches on each keystroke
          const s = searchRefByKey.get(sessionId);
          s?.clearDecorations();
          if (e.target.value) s?.findNext(e.target.value, opts);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) findPrev();
            else findNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        placeholder="查找…"
        className="w-44 rounded bg-neutral-950 px-2 py-0.5 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:ring-1 focus:ring-blue-500"
      />
      <button
        onClick={() => setCaseSensitive((v) => !v)}
        className={`rounded px-1 py-0.5 text-[11px] font-mono ${caseSensitive ? "bg-blue-600 text-white" : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"}`}
        title="区分大小写"
      >
        Aa
      </button>
      <button
        onClick={() => setWholeWord((v) => !v)}
        className={`rounded px-1 py-0.5 text-[11px] font-mono ${wholeWord ? "bg-blue-600 text-white" : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"}`}
        title="全词匹配"
      >
        ab
      </button>
      <button
        onClick={findPrev}
        className="rounded p-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        title="上一个（⇧↩）"
      >
        ↑
      </button>
      <button
        onClick={findNext}
        className="rounded p-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        title="下一个（↩）"
      >
        ↓
      </button>
      <button
        onClick={close}
        className="rounded p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
        title="关闭（Esc）"
      >
        ×
      </button>
    </div>
  );
}
