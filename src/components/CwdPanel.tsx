import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { cn, friendlyFsError } from "../lib/utils";
import { ConfirmDialog } from "./ConfirmDialog";
import { SudoPasswordDialog } from "./SudoPasswordDialog";
import { InputDialog } from "./InputDialog";
import {
  Folder,
  FileText,
  Link2,
  Download,
  Trash2,
  RefreshCw,
  X,
  Eye,
  EyeOff,
  FolderPlus,
  Pencil,
} from "lucide-react";

type Entry = {
  name: string;
  size: number;
  is_dir: boolean;
  is_link: boolean;
  mtime: number;
  mode: number;
};

type DownloadProgress = {
  remote: string;
  local: string;
  transferred: number;
  total: number;
  done: boolean;
};

type Props = {
  backendId: string;
  cwd: string;
  onClose: () => void;
  onOpenFile: (remotePath: string) => void;
};

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)}G`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}M`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}K`;
  return `${n}B`;
}

function formatMtime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function joinPath(base: string, name: string): string {
  if (base.endsWith("/")) return base + name;
  return base + "/" + name;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function parentOf(p: string): string {
  if (!p || p === "/") return "/";
  const trimmed = p.replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") return "/";
  const i = trimmed.lastIndexOf("/");
  if (i <= 0) return "/";
  return trimmed.slice(0, i);
}

export function CwdPanel({ backendId, cwd: cwdProp, onClose, onOpenFile }: Props) {
  // navCwd 非 null 时 = 独立浏览（AI 上传后的"定位到 /tmp"，不跟随终端）；
  // cwdProp 变化即重置（用户在终端 cd 后自然恢复同步）
  const [navCwd, setNavCwd] = useState<string | null>(null);
  const cwd = navCwd ?? cwdProp;
  useEffect(() => {
    setNavCwd(null);
  }, [cwdProp]);
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ backendId: string; path: string }>;
      if (ce.detail?.backendId === backendId && ce.detail?.path) {
        setNavCwd(ce.detail.path);
      }
    };
    window.addEventListener("hyper:show-remote-path", handler);
    return () =>
      window.removeEventListener("hyper:show-remote-path", handler);
  }, [backendId]);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 权限错误时给一键 sudo 建议用的命令；点按钮后弹密码对话框走 ssh_exec_sudo
  const [sudoRetry, setSudoRetry] = useState<
    { label: string; cmd: string; desc: string } | null
  >(null);
  const [sudoDialogOpen, setSudoDialogOpen] = useState(false);
  const [download, setDownload] = useState<DownloadProgress | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Entry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showMkdir, setShowMkdir] = useState(false);
  const [pendingRename, setPendingRename] = useState<Entry | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await invoke<Entry[]>("sftp_list", {
        sessionId: backendId,
        path: cwd,
      });
      setEntries(list);
    } catch (err) {
      setLoadError(String(err));
      setEntries([]);
    }
  }, [backendId, cwd]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let un: UnlistenFn | null = null;
    listen<DownloadProgress>(`sftp:download:${backendId}`, (e) => {
      setDownload(e.payload);
      if (e.payload.done) {
        setTimeout(() => setDownload(null), 1500);
      }
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, [backendId]);

  // 上传完成时仅当目标目录==当前浏览目录才刷新，避免无关跳转
  useEffect(() => {
    let un: UnlistenFn | null = null;
    const norm = (p: string) => p.replace(/\/+$/, "") || "/";
    listen<{ done: boolean; remote: string }>(
      `sftp:progress:${backendId}`,
      (e) => {
        if (!e.payload.done) return;
        const remote = e.payload.remote || "";
        const slash = remote.lastIndexOf("/");
        const parent = slash > 0 ? remote.slice(0, slash) : "/";
        if (norm(parent) === norm(cwd)) refresh();
      },
    ).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, [backendId, refresh, cwd]);

  const openDir = async (name: string) => {
    const target = name === ".." ? parentOf(cwd) : joinPath(cwd, name);
    if (navCwd !== null) {
      // 独立浏览模式：内部跳转，不动终端
      setNavCwd(target);
      return;
    }
    const cmd = name === ".." ? "cd .." : `cd ${shellQuote(target)}`;
    try {
      await invoke("ssh_send", {
        sessionId: backendId,
        data: `${cmd}\r`,
      });
    } catch (err) {
      setLoadError(String(err));
    }
  };

  const doMkdir = async (name: string) => {
    if (name.includes("/")) {
      setLoadError("目录名不能含 /");
      return;
    }
    try {
      await invoke("sftp_mkdir", {
        sessionId: backendId,
        remotePath: joinPath(cwd, name),
      });
      setShowMkdir(false);
      await refresh();
    } catch (err) {
      setLoadError(String(err));
      setShowMkdir(false);
    }
  };

  const doRename = async (entry: Entry, next: string) => {
    if (next.includes("/")) {
      setLoadError("名称不能含 /");
      return;
    }
    if (next === entry.name) {
      setPendingRename(null);
      return;
    }
    try {
      await invoke("sftp_rename", {
        sessionId: backendId,
        from: joinPath(cwd, entry.name),
        to: joinPath(cwd, next),
      });
      setPendingRename(null);
      await refresh();
    } catch (err) {
      setLoadError(String(err));
      setPendingRename(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = joinPath(cwd, pendingDelete.name);
    const isDir = pendingDelete.is_dir;
    setDeleting(true);
    setLoadError(null);
    setSudoRetry(null);
    try {
      await invoke("sftp_delete", {
        sessionId: backendId,
        remotePath: target,
      });
      setPendingDelete(null);
      await refresh();
    } catch (err) {
      const raw = String(err);
      const friendly = friendlyFsError(raw);
      setLoadError(friendly.message);
      if (friendly.canSudo) {
        const cmd = isDir
          ? `rm -rf -- ${shellQuote(target)}`
          : `rm -- ${shellQuote(target)}`;
        setSudoRetry({
          label: `用 sudo 删除 ${pendingDelete.name}`,
          cmd,
          desc: `${isDir ? "递归删除目录" : "删除文件"} ${target}`,
        });
        // 直接打开密码对话框：有缓存（15 分钟内）会静默执行成功；无缓存才显示密码框
        setSudoDialogOpen(true);
      }
    } finally {
      setDeleting(false);
    }
  };

  const downloadFile = async (entry: Entry) => {
    try {
      const target = await saveDialog({
        defaultPath: entry.name,
        title: `下载 ${entry.name}`,
      });
      if (!target) return;
      await invoke("sftp_download", {
        sessionId: backendId,
        remotePath: joinPath(cwd, entry.name),
        localPath: target,
      });
    } catch (err) {
      setLoadError(String(err));
    }
  };

  const visible = entries?.filter((e) => showHidden || !e.name.startsWith(".")) ?? [];
  const pct =
    download && download.total > 0
      ? (download.transferred / download.total) * 100
      : 0;

  return (
    <div className="flex w-[300px] shrink-0 flex-col border-l border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
        <div className="min-w-0 flex-1 truncate text-xs text-neutral-300">
          <span className="text-neutral-500">远端：</span>
          <span className="font-mono">{cwd}</span>
          {navCwd !== null && (
            <button
              onClick={() => setNavCwd(null)}
              className="ml-2 rounded bg-amber-900/40 px-1.5 py-0.5 text-[9px] text-amber-300 hover:bg-amber-900/60"
              title="当前独立于终端浏览（AI 上传跳转后）。点击跟随终端当前目录"
            >
              📌 独立 · 跟随终端
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowMkdir(true)}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            title="新建目录"
          >
            <FolderPlus size={12} />
          </button>
          <button
            onClick={() => setShowHidden((v) => !v)}
            className={cn(
              "rounded p-1",
              showHidden
                ? "bg-neutral-700 text-white"
                : "text-neutral-500 hover:text-neutral-200",
            )}
            title={showHidden ? "隐藏 . 开头的文件" : "显示 . 开头的隐藏文件"}
          >
            {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button
            onClick={refresh}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            title="刷新"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {entries === null && (
          <div className="py-8 text-center text-xs text-neutral-500">加载中…</div>
        )}
        {entries !== null && (
          <div className="py-0.5">
            {cwd !== "/" && (
              <Row
                icon={<Folder size={13} className="text-sky-400" />}
                name=".."
                meta=""
                onClick={() => openDir("..")}
                dim
              />
            )}
            {visible.length === 0 && (
              <div className="py-6 text-center text-xs text-neutral-600">
                空目录
              </div>
            )}
            {visible.map((e) => (
              <Row
                key={e.name}
                icon={
                  e.is_dir ? (
                    <Folder size={13} className="text-sky-400" />
                  ) : e.is_link ? (
                    <Link2 size={13} className="text-neutral-400" />
                  ) : (
                    <FileText size={13} className="text-neutral-400" />
                  )
                }
                name={e.name}
                meta={
                  e.is_dir
                    ? formatMtime(e.mtime)
                    : `${formatBytes(e.size)}  ${formatMtime(e.mtime)}`
                }
                onClick={() =>
                  e.is_dir ? openDir(e.name) : onOpenFile(joinPath(cwd, e.name))
                }
                download={e.is_dir ? undefined : () => downloadFile(e)}
                onRename={() => setPendingRename(e)}
                onDelete={() => setPendingDelete(e)}
              />
            ))}
          </div>
        )}
        {loadError && (
          <div className="mx-2 my-2 rounded border border-red-900/50 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
            <div className="flex items-start justify-between gap-2">
              <span className="break-all">{loadError}</span>
              <button
                type="button"
                onClick={() => {
                  setLoadError(null);
                  setSudoRetry(null);
                }}
                className="shrink-0 rounded p-0.5 text-red-400 hover:bg-red-900/40 hover:text-neutral-100"
                title="关闭"
              >
                <X size={11} />
              </button>
            </div>
            {sudoRetry && (
              <button
                type="button"
                onClick={() => setSudoDialogOpen(true)}
                className="mt-1.5 w-full rounded bg-red-600/80 px-2 py-1 text-xs text-white hover:bg-red-600"
                title={`sudo ${sudoRetry.cmd}`}
              >
                {sudoRetry.label}
              </button>
            )}
          </div>
        )}
      </div>

      {showMkdir && (
        <InputDialog
          title={`在 ${cwd} 新建目录`}
          label="目录名"
          placeholder="例如：logs"
          confirmText="创建"
          onConfirm={(name) => doMkdir(name)}
          onCancel={() => setShowMkdir(false)}
        />
      )}

      {pendingRename && (
        <InputDialog
          title="重命名"
          label={`当前：${pendingRename.name}`}
          defaultValue={pendingRename.name}
          confirmText="重命名"
          onConfirm={(next) => doRename(pendingRename, next)}
          onCancel={() => setPendingRename(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.is_dir ? "删除目录" : "删除文件"}
          message={`确认删除 ${pendingDelete.is_dir ? "目录" : "文件"} "${pendingDelete.name}"${pendingDelete.is_dir ? "（目录必须为空）" : ""}？此操作不可撤销。`}
          confirmText={deleting ? "删除中…" : "删除"}
          danger
          onConfirm={confirmDelete}
          onCancel={() => !deleting && setPendingDelete(null)}
        />
      )}

      {sudoDialogOpen && sudoRetry && (
        <SudoPasswordDialog
          backendId={backendId}
          command={sudoRetry.cmd}
          description={sudoRetry.desc}
          onSuccess={async () => {
            setSudoDialogOpen(false);
            setSudoRetry(null);
            setLoadError(null);
            setPendingDelete(null);
            await refresh();
          }}
          onCancel={() => setSudoDialogOpen(false)}
        />
      )}

      {download && (
        <div className="border-t border-neutral-800 px-3 py-1.5 text-xs">
          <div className="flex justify-between text-neutral-500">
            <span className="truncate">
              {download.done ? "✓ 下载完成 " : "↓ "}
              {download.remote.split("/").pop()}
            </span>
            <span className="shrink-0 font-mono">
              {formatBytes(download.transferred)} / {formatBytes(download.total)}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded bg-neutral-800">
            <div
              className={cn(
                "h-full",
                download.done ? "bg-emerald-500" : "bg-blue-500",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  icon,
  name,
  meta,
  onClick,
  dim,
  download,
  onRename,
  onDelete,
}: {
  icon: React.ReactNode;
  name: string;
  meta: string;
  onClick: () => void;
  dim?: boolean;
  download?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 px-3 py-1 text-sm hover:bg-neutral-800/60",
        dim && "text-neutral-500",
      )}
    >
      <button
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="flex-1 truncate font-mono text-[13px]">{name}</span>
        <span className="shrink-0 text-[11px] text-neutral-500">{meta}</span>
      </button>
      {(download || onRename || onDelete) && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
          {download && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                download();
              }}
              title="下载到本地"
              className="rounded p-1 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100"
            >
              <Download size={11} />
            </button>
          )}
          {onRename && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
              title="重命名"
              className="rounded p-1 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100"
            >
              <Pencil size={11} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="删除"
              className="rounded p-1 text-neutral-500 hover:bg-red-900/60 hover:text-red-200"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
