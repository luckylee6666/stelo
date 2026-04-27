import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useKeyStore, type SshKey } from "../stores/keys";
import { cn } from "../lib/utils";
import { ConfirmDialog } from "./ConfirmDialog";
import { useDialogEscape } from "../lib/useDialogEscape";

type Props = {
  onClose: () => void;
};

export function KeyManagerDialog({ onClose }: Props) {
  const keys = useKeyStore((s) => s.keys);
  const addKey = useKeyStore((s) => s.addKey);
  const updateKey = useKeyStore((s) => s.updateKey);
  const removeKey = useKeyStore((s) => s.removeKey);

  const [editing, setEditing] = useState<SshKey | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SshKey | null>(null);

  useDialogEscape(onClose, !editing && !adding && !confirmDelete);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[500px] w-[560px] flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">密钥管理</h2>
            <p className="text-xs text-neutral-500">
              统一管理 SSH 私钥，会话创建时可直接引用
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {keys.length === 0 && !adding && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-neutral-500">
              <span>还没有保存的密钥</span>
              <button
                onClick={() => setAdding(true)}
                className="mt-2 rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500"
              >
                + 新建密钥
              </button>
            </div>
          )}

          {keys.length > 0 && (
            <div className="divide-y divide-neutral-800">
              {keys.map((k) => (
                <div
                  key={k.id}
                  className="group flex items-center gap-3 px-5 py-2.5 hover:bg-neutral-800/30"
                >
                  <span className="text-lg">🔑</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-neutral-100">
                      {k.name}
                    </div>
                    <div className="truncate font-mono text-xs text-neutral-500">
                      {k.path}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => setEditing(k)}
                      className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => setConfirmDelete(k)}
                      className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-red-900/60 hover:text-red-200"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {keys.length > 0 && !adding && (
          <div className="shrink-0 border-t border-neutral-800 px-5 py-3">
            <button
              onClick={() => setAdding(true)}
              className="rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500"
            >
              + 新建密钥
            </button>
          </div>
        )}
      </div>

      {adding && (
        <KeyForm
          onSubmit={(name, path, passphrase, remember) => {
            const id = addKey(name, path);
            if (remember && passphrase) {
              invoke("credential_save", {
                account: `key:${id}:passphrase`,
                secret: passphrase,
              }).catch((e) => console.error("credential_save failed:", e));
            }
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {editing && (
        <KeyForm
          initial={editing}
          onSubmit={(name, path, passphrase, remember) => {
            updateKey(editing.id, { name, path });
            const account = `key:${editing.id}:passphrase`;
            if (remember && passphrase) {
              invoke("credential_save", { account, secret: passphrase }).catch(
                (e) => console.error("credential_save failed:", e),
              );
            } else if (!remember) {
              invoke("credential_delete", { account }).catch(() => {});
            }
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="删除密钥"
          message={`确认删除密钥"${confirmDelete.name}"？引用这个密钥的会话连接时会失败。`}
          confirmText="删除"
          danger
          onConfirm={() => {
            removeKey(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function KeyForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: SshKey;
  onSubmit: (
    name: string,
    path: string,
    passphrase: string,
    remember: boolean,
  ) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [path, setPath] = useState(initial?.path ?? "~/.ssh/id_ed25519");
  const [passphrase, setPassphrase] = useState("");
  const [savedExists, setSavedExists] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => ref.current?.focus(), 40);
    if (initial?.id) {
      invoke<string | null>("credential_load", {
        account: `key:${initial.id}:passphrase`,
      }).then((v) => {
        if (v) {
          setPassphrase(v);
          setSavedExists(true);
        }
      });
    }
  }, [initial?.id]);

  const pick = async () => {
    try {
      const picked = await openFileDialog({
        multiple: false,
        directory: false,
        title: "选择私钥文件",
        defaultPath: "~/.ssh",
      });
      if (typeof picked === "string") {
        setPath(picked.endsWith(".pub") ? picked.slice(0, -4) : picked);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) {
      setError("名称和路径必填");
      return;
    }
    onSubmit(name.trim(), path.trim(), passphrase, remember);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[440px] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
      >
        <h3 className="mb-3 text-sm font-semibold text-neutral-100">
          {initial ? "编辑密钥" : "新建密钥"}
        </h3>

        <div className="space-y-3 text-sm">
          <Field label="名称">
            <input
              ref={ref}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：生产服务器密钥 / 个人 ED25519"
              className={inputCls}
            />
          </Field>

          <Field label="私钥文件路径">
            <div className="flex gap-2">
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className={inputCls}
              />
              <button
                type="button"
                onClick={pick}
                className="shrink-0 rounded border border-neutral-700 px-2.5 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                浏览…
              </button>
            </div>
          </Field>

          <Field label="密码短语（可选）">
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={savedExists ? "（已保存，留空则保留）" : "仅加密私钥需要"}
              className={inputCls}
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            记住密码短语（保存到本地应用目录）
            {savedExists && (
              <span className="text-emerald-500">· 已保存</span>
            )}
          </label>
        </div>

        {error && (
          <div className={cn(
            "mt-3 rounded border border-red-900/50 bg-red-950/40 px-2 py-1.5 text-xs text-red-300",
          )}>
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}
