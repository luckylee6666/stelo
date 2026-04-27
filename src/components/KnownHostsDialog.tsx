import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShieldCheck, Trash2, RefreshCw } from "lucide-react";

type Entry = {
  host: string;
  port: number;
  key_type: string;
  fingerprint: string;
  first_seen: number;
};

type Props = {
  onClose: () => void;
};

function fmtDate(ts: number): string {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function KnownHostsDialog({ onClose }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Entry | null>(null);

  const refresh = async () => {
    try {
      const list = await invoke<Entry[]>("known_hosts_list");
      setEntries(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const doDelete = async (e: Entry) => {
    try {
      await invoke("known_hosts_remove", { host: e.host, port: e.port });
      setPendingDelete(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[640px] flex-col rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-emerald-400" />
            <h2 className="text-sm font-semibold text-neutral-100">
              已记录的主机密钥（known_hosts）
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              title="刷新"
            >
              <RefreshCw size={12} />
            </button>
            <button
              onClick={onClose}
              className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {error && (
            <div className="mb-3 rounded border border-red-900/50 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
              {error}
            </div>
          )}
          {!entries && !error && (
            <div className="py-8 text-center text-xs text-neutral-500">加载中…</div>
          )}
          {entries && entries.length === 0 && (
            <div className="py-8 text-center text-xs text-neutral-500">
              还没有任何主机记录。连接 SSH 时会自动 TOFU 写入。
            </div>
          )}
          {entries && entries.length > 0 && (
            <table className="w-full text-xs">
              <thead className="text-xs uppercase tracking-wider text-neutral-500">
                <tr className="border-b border-neutral-800">
                  <th className="pb-1.5 text-left font-normal">主机</th>
                  <th className="pb-1.5 text-left font-normal">算法</th>
                  <th className="pb-1.5 text-left font-normal">首次记录</th>
                  <th className="pb-1.5 text-right font-normal"> </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={`${e.host}:${e.port}`}
                    className="group border-b border-neutral-800/50 hover:bg-neutral-800/30"
                  >
                    <td className="py-2 pr-2 align-top font-mono text-neutral-200">
                      <div>
                        {e.host}:{e.port}
                      </div>
                      <div className="mt-0.5 break-all text-[11px] text-neutral-500">
                        {e.fingerprint}
                      </div>
                    </td>
                    <td className="py-2 pr-2 align-top text-neutral-400">
                      {e.key_type}
                    </td>
                    <td className="py-2 pr-2 align-top text-neutral-400">
                      {fmtDate(e.first_seen)}
                    </td>
                    <td className="py-2 text-right align-top">
                      <button
                        onClick={() => setPendingDelete(e)}
                        className="rounded p-1 text-neutral-500 opacity-0 hover:bg-red-900/40 hover:text-red-300 group-hover:opacity-100"
                        title="删除此记录（下次连接会重新 TOFU）"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-2 text-xs text-neutral-500">
          删除后下次连接该主机会把最新指纹当作"新主机"再次 TOFU 记录；不会弹 MITM 警告（因为 known_hosts 里没有可比对的旧指纹了）。
        </div>

        {pendingDelete && (
          <div
            className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70"
            onClick={() => setPendingDelete(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-[380px] rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-2xl"
            >
              <h3 className="mb-2 text-sm font-semibold text-neutral-100">
                删除 {pendingDelete.host}:{pendingDelete.port}？
              </h3>
              <p className="text-xs text-neutral-400">
                下次连接会把远端密钥当作新主机 TOFU 记录；如果远端真的被替换了（MITM
                攻击场景），这会绕过警告。你确认要删吗？
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setPendingDelete(null)}
                  className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
                >
                  取消
                </button>
                <button
                  onClick={() => doDelete(pendingDelete)}
                  className="rounded bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
