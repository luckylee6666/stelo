import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Image as ImageIcon, X } from "lucide-react";

type Props = {
  backendId: string;
  remotePath: string;
  onClose: () => void;
};

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
};

export const IMAGE_EXT = new Set(Object.keys(MIME));

export function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXT.has(ext);
}

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export function ImagePreview({ backendId, remotePath, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("sftp_read_bytes", {
      sessionId: backendId,
      remotePath,
    })
      .then((b64) => {
        setUrl(`data:${mimeFor(remotePath)};base64,${b64}`);
      })
      .catch((err) => setError(String(err)));
  }, [backendId, remotePath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-neutral-800 px-3">
        <ImageIcon size={14} className="text-neutral-400" />
        <span className="flex-1 truncate font-mono text-sm text-neutral-200">
          {remotePath}
        </span>
        <button
          onClick={onClose}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        {error && (
          <div className="max-w-lg rounded border border-red-900/50 bg-red-950/40 p-3 text-xs text-red-300">
            {error}
          </div>
        )}
        {!error && !url && (
          <div className="text-sm text-neutral-500">加载中…</div>
        )}
        {url && (
          <img
            src={url}
            alt={remotePath}
            className="max-h-full max-w-full object-contain shadow-xl"
          />
        )}
      </div>
    </div>
  );
}
