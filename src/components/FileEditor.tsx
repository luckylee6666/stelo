import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { PencilLine, X, Save } from "lucide-react";

type Props = {
  backendId: string;
  remotePath: string;
  onClose: () => void;
};

const LANG: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  toml: "toml",
  xml: "xml",
  sql: "sql",
  conf: "ini",
  cfg: "ini",
  ini: "ini",
  env: "ini",
  dockerfile: "dockerfile",
  csv: "plaintext",
  tsv: "plaintext",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  php: "php",
  lua: "lua",
  vue: "html",
  svelte: "html",
};

function detectLang(path: string): string {
  const base = (path.split("/").pop() ?? path).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === "makefile") return "makefile";
  if (base.endsWith(".service") || base.endsWith(".timer")) return "ini";
  if (base.startsWith(".")) {
    // .bashrc, .zshrc, .vimrc 等
    if (base.includes("rc") || base.includes("profile")) return "shell";
  }
  const ext = base.split(".").pop();
  if (!ext) return "plaintext";
  return LANG[ext] ?? "plaintext";
}

export function FileEditor({ backendId, remotePath, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    invoke<string>("sftp_read", {
      sessionId: backendId,
      remotePath,
    })
      .then((text) => {
        setContent(text);
        setOriginal(text);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [backendId, remotePath]);

  const dirty = content !== null && content !== original;

  const save = async () => {
    if (content === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await invoke("sftp_write", {
        sessionId: backendId,
        remotePath,
        content,
      });
      setOriginal(content);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const tryClose = () => {
    if (dirty && !confirm("有未保存改动，确定关闭?")) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) {
        // 不在 ctrl+esc / cmd+esc 时才关闭
        const target = e.target as HTMLElement;
        if (target?.closest?.(".monaco-editor")) return;
        tryClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, original, saving]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-neutral-800 px-3">
        <PencilLine size={14} className="text-neutral-400" />
        <span className="flex-1 truncate font-mono text-sm text-neutral-200">
          {remotePath}
        </span>
        {dirty && (
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] uppercase tracking-wider text-amber-400">
            未保存
          </span>
        )}
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          <Save size={12} />
          {saving ? "保存中…" : "保存 ⌘S"}
        </button>
        <button
          onClick={tryClose}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <X size={16} />
        </button>
      </div>
      {loading && (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
          加载中…
        </div>
      )}
      {error && !loading && (
        <div className="m-3 rounded border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {!loading && content !== null && (
        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            value={content}
            onChange={(v) => setContent(v ?? "")}
            language={detectLang(remotePath)}
            theme="vs-dark"
            options={{
              fontFamily: '"SF Mono", Menlo, Monaco, monospace',
              fontSize: 13,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              tabSize: 2,
              wordWrap: "on",
              automaticLayout: true,
            }}
          />
        </div>
      )}
    </div>
  );
}
