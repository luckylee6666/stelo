import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  open as openFileDialog,
  save as saveFileDialog,
} from "@tauri-apps/plugin-dialog";
import {
  Download,
  Upload,
  AlertTriangle,
  Check,
  Loader2,
  Database,
} from "lucide-react";

type Props = {
  onClose: () => void;
};

type LocalPrefs = Record<string, unknown>;

function collectLocalStoragePrefs(): LocalPrefs {
  const prefs: LocalPrefs = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    // 只收集 hypershell.* 前缀的，排除敏感/临时项
    if (!k.startsWith("hypershell.")) continue;
    const v = localStorage.getItem(k);
    if (v !== null) prefs[k] = v;
  }
  return prefs;
}

function applyLocalStoragePrefs(prefs: LocalPrefs) {
  for (const [k, v] of Object.entries(prefs)) {
    if (typeof v === "string") localStorage.setItem(k, v);
  }
}

export function ConfigBackupDialog({ onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const doExport = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const prefs = collectLocalStoragePrefs();
      const date = new Date().toISOString().slice(0, 10);
      const target = await saveFileDialog({
        defaultPath: `stelo-config-${date}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!target) {
        setBusy(false);
        return;
      }
      await invoke("config_export_file", { path: target, prefs });
      setMsg(`已导出到 ${target}`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const picked = await openFileDialog({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!picked) {
        setBusy(false);
        return;
      }
      const path = Array.isArray(picked) ? picked[0] : picked;
      const prefs = await invoke<LocalPrefs | null>("config_import_file", { path });
      if (prefs && typeof prefs === "object") {
        applyLocalStoragePrefs(prefs);
      }
      setMsg("导入完成。正在刷新数据…");
      // 触发全量重载
      setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <Database size={16} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-neutral-100">
            配置导出 / 导入
          </h2>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-neutral-400">
          导出的 JSON 包含：会话列表 / 分组 / 密钥元信息 / 快捷指令 / AI Provider 配置 /
          命令历史 / known_hosts / 主题字体等偏好。
          <br />
          <span className="text-amber-400">
            但**不含** SSH 密码 / 密钥 passphrase / AI API Key
          </span>
          （这些在 credentials.json，不走备份）—— 导入后需重新填。
        </p>

        <div className="space-y-2">
          <button
            onClick={doExport}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            导出到 JSON 文件
          </button>
          <button
            onClick={doImport}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded border border-amber-600 bg-amber-950/40 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-900/50 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            从 JSON 文件导入（全量覆盖）
          </button>
        </div>

        {msg && (
          <div className="mt-3 flex items-start gap-1.5 rounded border border-emerald-900/60 bg-emerald-950/30 px-2 py-1.5 text-xs text-emerald-200">
            <Check size={11} className="mt-0.5 shrink-0" />
            <span className="break-all">{msg}</span>
          </div>
        )}
        {err && (
          <div className="mt-3 flex items-start gap-1.5 rounded border border-red-900/50 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span className="break-all">{err}</span>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
