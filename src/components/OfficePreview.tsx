import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { FileSpreadsheet, FileText, X } from "lucide-react";

type Props = {
  backendId: string;
  remotePath: string;
  onClose: () => void;
};

const SPREADSHEET_EXT = new Set(["xlsx", "xls", "csv", "ods", "tsv"]);
const WORD_EXT = new Set(["docx"]);
const UNSUPPORTED_OLD_WORD = new Set(["doc"]);

export const OFFICE_EXT = new Set<string>([
  ...SPREADSHEET_EXT,
  ...WORD_EXT,
  ...UNSUPPORTED_OLD_WORD,
]);

export function isOfficePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return !!ext && OFFICE_EXT.has(ext);
}

function extOf(path: string): string {
  return (path.split(".").pop() ?? "").toLowerCase();
}

function decodeB64(b64: string): Uint8Array {
  const raw = atob(b64);
  const u8 = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
  return u8;
}

type Sheet = { name: string; html: string };

export function OfficePreview({ backendId, remotePath, onClose }: Props) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [wordHtml, setWordHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const ext = useMemo(() => extOf(remotePath), [remotePath]);

  useEffect(() => {
    setSheets(null);
    setWordHtml(null);
    setError(null);
    setActiveSheet(0);
    setLoading(true);

    if (UNSUPPORTED_OLD_WORD.has(ext)) {
      setError(
        "不支持 .doc（Word 97-2003 二进制格式）预览；请在 CwdPanel hover 时点 ↓ 下载到本地打开。",
      );
      setLoading(false);
      return;
    }

    invoke<string>("sftp_read_bytes", {
      sessionId: backendId,
      remotePath,
    })
      .then(async (b64) => {
        const bytes = decodeB64(b64);
        if (SPREADSHEET_EXT.has(ext)) {
          try {
            const wb = XLSX.read(bytes.buffer, { type: "array" });
            const list: Sheet[] = wb.SheetNames.map((name) => ({
              name,
              html: XLSX.utils.sheet_to_html(wb.Sheets[name]),
            }));
            setSheets(list);
          } catch (e) {
            setError(`解析表格失败: ${e}`);
          }
        } else if (WORD_EXT.has(ext)) {
          try {
            const result = await mammoth.convertToHtml({
              arrayBuffer: bytes.buffer as ArrayBuffer,
            });
            setWordHtml(result.value);
          } catch (e) {
            setError(`解析 Word 文档失败: ${e}`);
          }
        } else {
          setError(`暂不支持 .${ext} 预览`);
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [backendId, remotePath, ext]);

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
        {SPREADSHEET_EXT.has(ext) ? (
          <FileSpreadsheet size={14} className="text-emerald-400" />
        ) : (
          <FileText size={14} className="text-blue-400" />
        )}
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

      {sheets && sheets.length > 1 && (
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-neutral-800 bg-neutral-950 px-2 py-1">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActiveSheet(i)}
              className={
                i === activeSheet
                  ? "rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-100"
                  : "rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              }
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-white text-neutral-900">
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            加载中…
          </div>
        )}
        {error && (
          <div className="m-6 max-w-xl rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}
        {!loading && !error && sheets && sheets[activeSheet] && (
          <div
            className="office-preview overflow-auto p-4"
            dangerouslySetInnerHTML={{ __html: sheets[activeSheet].html }}
          />
        )}
        {!loading && !error && wordHtml !== null && (
          <div
            className="office-preview mx-auto max-w-4xl p-8 leading-relaxed"
            style={{ fontFamily: '"PingFang SC", system-ui, sans-serif' }}
            dangerouslySetInnerHTML={{ __html: wordHtml }}
          />
        )}
      </div>

      <style>{`
        .office-preview table { border-collapse: collapse; font-size: 13px; }
        .office-preview td, .office-preview th {
          border: 1px solid #d4d4d4;
          padding: 4px 8px;
          min-width: 60px;
        }
        .office-preview h1, .office-preview h2, .office-preview h3 { margin: 1em 0 0.5em; font-weight: 600; }
        .office-preview h1 { font-size: 1.6em; }
        .office-preview h2 { font-size: 1.35em; }
        .office-preview h3 { font-size: 1.15em; }
        .office-preview p { margin: 0.5em 0; }
        .office-preview a { color: #2563eb; text-decoration: underline; }
        .office-preview ul, .office-preview ol { padding-left: 1.5em; }
      `}</style>
    </div>
  );
}
