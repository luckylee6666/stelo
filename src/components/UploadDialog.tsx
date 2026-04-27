import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCachedSudo, setCachedSudo, clearCachedSudo } from "../lib/sudoCache";

type Props = {
  backendId: string;
  defaultRemote: string;
  files: string[];
  onClose: () => void;
};

type Progress = {
  local: string;
  remote: string;
  transferred: number;
  total: number;
  done: boolean;
};

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function UploadDialog({ backendId, defaultRemote, files, onClose }: Props) {
  const [remote, setRemote] = useState(
    defaultRemote.endsWith("/") ? defaultRemote : defaultRemote + "/",
  );
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const cachedPw = getCachedSudo(backendId) ?? "";
  const [sudoMode, setSudoMode] = useState(false);
  const [sudoPassword, setSudoPassword] = useState(cachedPw);
  const hasCachedPw = cachedPw.length > 0;

  useEffect(() => {
    let un: UnlistenFn | null = null;
    listen<Progress>(`sftp:progress:${backendId}`, (e) => {
      setProgress(e.payload);
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, [backendId]);

  const startUpload = async () => {
    if (uploading) return;
    if (sudoMode && !sudoPassword) {
      setError("请先输入 sudo 密码");
      return;
    }
    setUploading(true);
    setError(null);
    setDoneCount(0);
    // 本次循环里是否已经升级到 sudo 模式（避免每个文件都先 SFTP 失败再 sudo）
    let useSudo = sudoMode;
    let pw = sudoPassword;
    try {
      for (let i = 0; i < files.length; i++) {
        setCurrentIdx(i);
        try {
          if (useSudo) {
            await invoke<string>("sftp_upload_with_sudo", {
              sessionId: backendId,
              localPath: files[i],
              remotePath: remote,
              password: pw,
            });
          } else {
            await invoke<string>("sftp_upload", {
              sessionId: backendId,
              localPath: files[i],
              remotePath: remote,
            });
          }
        } catch (err) {
          const msg = String(err);
          // 普通 SFTP 碰到 Permission denied → 动态判定该路径需要 sudo
          if (!useSudo && /permission denied/i.test(msg)) {
            const cached = getCachedSudo(backendId);
            if (cached) {
              // 缓存命中：静默重试当前文件，并切换后续文件也走 sudo
              await invoke<string>("sftp_upload_with_sudo", {
                sessionId: backendId,
                localPath: files[i],
                remotePath: remote,
                password: cached,
              });
              useSudo = true;
              pw = cached;
              setSudoMode(true);
              setSudoPassword(cached);
            } else {
              // 无缓存：切 sudoMode 让用户输密码，本次终止等待用户再点上传
              setSudoMode(true);
              setError("此目录需要 sudo 权限，请输入密码后再次点击上传");
              return;
            }
          } else {
            throw err; // 非权限错误，正常往上抛
          }
        }
        setDoneCount(i + 1);
      }
      // 全部成功才缓存密码——避免错的密码被记下
      if (useSudo && pw) {
        setCachedSudo(backendId, pw);
      }
      setTimeout(onClose, 400);
    } catch (err) {
      const msg = String(err);
      setError(msg);
      // sudo 密码错了立即清掉缓存，下次重新输
      if (/sudo password incorrect/i.test(msg)) {
        clearCachedSudo(backendId);
        setSudoPassword("");
      }
    } finally {
      setUploading(false);
    }
  };

  const pct = progress && progress.total > 0
    ? (progress.transferred / progress.total) * 100
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !uploading && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[460px] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
      >
        <h2 className="mb-3 text-base font-semibold text-neutral-100">
          上传到服务器
        </h2>

        <div className="mb-3 max-h-40 overflow-auto rounded border border-neutral-800 bg-neutral-950 p-2 text-xs font-mono text-neutral-300">
          {files.map((f, i) => (
            <div
              key={i}
              className={`truncate py-0.5 ${
                uploading && i === currentIdx
                  ? "text-amber-400"
                  : i < doneCount
                    ? "text-emerald-500"
                    : ""
              }`}
            >
              {i < doneCount ? "✓ " : uploading && i === currentIdx ? "↑ " : "  "}
              {f}
            </div>
          ))}
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
            远端路径（目录或完整文件名）
          </span>
          <input
            disabled={uploading}
            value={remote}
            onChange={(e) => setRemote(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500 disabled:opacity-60"
            placeholder="/root/ 或 /tmp/file.txt"
          />
        </label>

        {progress && (
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-xs text-neutral-500">
              <span className="truncate">
                {basename(progress.local)} → {progress.remote}
              </span>
              <span className="shrink-0 font-mono">
                {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded bg-neutral-800">
              <div
                className={`h-full ${progress.done ? "bg-emerald-500" : "bg-blue-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded border border-red-900/50 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
            <div className="break-all">{error}</div>
            {/permission denied/i.test(error) && !sudoMode && (
              <div className="mt-1.5 text-neutral-400">
                当前用户对该路径无写入权限。可以：
                <button
                  type="button"
                  onClick={() => {
                    setSudoMode(true);
                    setError(null);
                  }}
                  className="ml-1 rounded bg-amber-700/60 px-1.5 py-0.5 font-mono text-amber-100 hover:bg-amber-700"
                >
                  用 sudo 上传
                </button>
                <span className="mx-1">或切到可写目录</span>
                <button
                  type="button"
                  onClick={() => setRemote("~/")}
                  className="ml-1 rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-neutral-200 hover:bg-neutral-700"
                >
                  ~/
                </button>
                <button
                  type="button"
                  onClick={() => setRemote("/tmp/")}
                  className="ml-1 rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-neutral-200 hover:bg-neutral-700"
                >
                  /tmp/
                </button>
              </div>
            )}
            {/sudo password incorrect/i.test(error) && (
              <div className="mt-1.5 text-neutral-400">sudo 密码不正确，请重试。</div>
            )}
          </div>
        )}

        {sudoMode && hasCachedPw && (
          <div className="mt-3 flex items-center justify-between rounded border border-amber-900/50 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-300">
            <span>🛡 已记住本会话 sudo 密码，免输入</span>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={uploading}
                onClick={() => {
                  clearCachedSudo(backendId);
                  setSudoPassword("");
                }}
                className="text-neutral-400 hover:text-neutral-200"
              >
                忘记密码
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={() => {
                  setSudoMode(false);
                  setSudoPassword("");
                }}
                className="text-neutral-500 hover:text-neutral-300"
              >
                取消 sudo
              </button>
            </span>
          </div>
        )}

        {sudoMode && !hasCachedPw && (
          <label className="mt-3 block text-sm">
            <span className="mb-1 flex items-center justify-between text-xs uppercase tracking-wider text-amber-400">
              <span>SUDO 密码（先传到 /tmp，再 sudo mv 到目标）</span>
              <button
                type="button"
                disabled={uploading}
                onClick={() => {
                  setSudoMode(false);
                  setSudoPassword("");
                }}
                className="text-[10px] normal-case tracking-normal text-neutral-500 hover:text-neutral-300"
              >
                取消 sudo
              </button>
            </span>
            <input
              type="password"
              autoFocus
              disabled={uploading}
              value={sudoPassword}
              onChange={(e) => setSudoPassword(e.target.value)}
              className="w-full rounded border border-amber-700/60 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-amber-500 disabled:opacity-60"
              placeholder="当前登录用户的密码"
            />
          </label>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          >
            {uploading ? "进行中…" : "取消"}
          </button>
          <button
            type="button"
            disabled={uploading || !remote.trim()}
            onClick={startUpload}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {uploading
              ? `上传中 ${doneCount}/${files.length}`
              : sudoMode
                ? `🛡 sudo 上传 ${files.length} 个文件`
                : `上传 ${files.length} 个文件`}
          </button>
        </div>
      </div>
    </div>
  );
}
