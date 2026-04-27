import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { sshConnect } from "../lib/sshConnect";
import { useSessionStore } from "../stores/sessions";
import { useKeyStore } from "../stores/keys";
import { cn } from "../lib/utils";
import { GroupSelect } from "./GroupSelect";
import { useDialogEscape } from "../lib/useDialogEscape";

type Props = {
  open: boolean;
  onClose: () => void;
};

type AuthMode = "password" | "private_key";
type KeySource = "manual" | "saved";

type Auth =
  | { kind: "password"; password: string }
  | { kind: "private_key"; key_path: string; passphrase: string | null };

export function NewSessionDialog({ open, onClose }: Props) {
  const addSshConnected = useSessionStore((s) => s.addSshConnected);
  const addLocal = useSessionStore((s) => s.addLocal);
  const savedKeys = useKeyStore((s) => s.keys);

  useDialogEscape(onClose, open);

  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("");
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState<string | undefined>(undefined);
  const [authMode, setAuthMode] = useState<AuthMode>("password");
  const [keySource, setKeySource] = useState<KeySource>("saved");
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("~/.ssh/id_rsa");
  const [passphrase, setPassphrase] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const hostRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setConnecting(false);
      if (savedKeys.length > 0 && !selectedKeyId) {
        setSelectedKeyId(savedKeys[0].id);
        setKeySource("saved");
      } else if (savedKeys.length === 0) {
        setKeySource("manual");
      }
      setTimeout(() => hostRef.current?.focus(), 40);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const reset = () => {
    setHost("");
    setPort("22");
    setUser("");
    setPassword("");
    setPassphrase("");
    setKeyPath("~/.ssh/id_rsa");
    setName("");
    setGroupId(undefined);
    setAuthMode("password");
    setKeySource(savedKeys.length > 0 ? "saved" : "manual");
    setSelectedKeyId(savedKeys[0]?.id ?? "");
    setError(null);
    setConnecting(false);
  };

  const pickKeyFile = async () => {
    try {
      const picked = await openFileDialog({
        multiple: false,
        directory: false,
        title: "选择私钥文件（不是 .pub）",
        defaultPath: "~/.ssh",
      });
      if (typeof picked === "string" && picked) {
        if (picked.endsWith(".pub")) {
          setError("这是公钥（.pub）；请选择同目录下对应的私钥文件");
          setKeyPath(picked.slice(0, -4));
          return;
        }
        setError(null);
        setKeyPath(picked);
      }
    } catch (e) {
      setError(`打开文件选择失败: ${e}`);
    }
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (connecting) return;
    if (!host.trim() || !user.trim()) {
      setError("主机和用户名必填");
      return;
    }
    const p = Number(port);
    if (!Number.isInteger(p) || p <= 0 || p > 65535) {
      setError("端口号不合法");
      return;
    }
    let resolvedKeyPath = "";
    let resolvedPassphrase: string | null = null;
    if (authMode === "private_key") {
      if (keySource === "saved") {
        if (!selectedKeyId) {
          setError("请选择一个已保存的密钥，或切换到手动模式");
          return;
        }
        const k = savedKeys.find((x) => x.id === selectedKeyId);
        if (!k) {
          setError("选中的密钥不存在");
          return;
        }
        resolvedKeyPath = k.path;
        // 尝试从已保存的凭据读取 passphrase
        try {
          const saved = await invoke<string | null>("credential_load", {
            account: `key:${k.id}:passphrase`,
          });
          resolvedPassphrase = saved ?? (passphrase ? passphrase : null);
        } catch {
          resolvedPassphrase = passphrase ? passphrase : null;
        }
      } else {
        if (!keyPath.trim()) {
          setError("私钥文件路径必填");
          return;
        }
        resolvedKeyPath = keyPath.trim();
        resolvedPassphrase = passphrase ? passphrase : null;
      }
    }

    const auth: Auth =
      authMode === "password"
        ? { kind: "password", password }
        : {
            kind: "private_key",
            key_path: resolvedKeyPath,
            passphrase: resolvedPassphrase,
          };

    setConnecting(true);
    setError(null);
    try {
      const backendId = await sshConnect({
        host: host.trim(),
        port: p,
        user: user.trim(),
        auth,
        cols: 120,
        rows: 32,
      });
      const useSavedKey =
        authMode === "private_key" && keySource === "saved";
      // 新建会话默认没有 portForwards；建完可以在"编辑会话"里添加
      const sessionId = addSshConnected({
        host: host.trim(),
        port: p,
        user: user.trim(),
        backendId,
        authMode,
        keyPath:
          authMode === "private_key" && keySource === "manual"
            ? keyPath.trim()
            : undefined,
        keyId: useSavedKey ? selectedKeyId : undefined,
        groupId,
        name: name.trim() || undefined,
      });
      if (remember) {
        if (authMode === "password" && password) {
          invoke("credential_save", {
            account: `${sessionId}:password`,
            secret: password,
          }).catch((e) => console.error("credential_save failed:", e));
        } else if (authMode === "private_key" && keySource === "manual" && passphrase) {
          invoke("credential_save", {
            account: `${sessionId}:passphrase`,
            secret: passphrase,
          }).catch((e) => console.error("credential_save failed:", e));
        } else if (authMode === "private_key" && keySource === "saved" && passphrase) {
          invoke("credential_save", {
            account: `key:${selectedKeyId}:passphrase`,
            secret: passphrase,
          }).catch((e) => console.error("credential_save failed:", e));
        }
      }
      reset();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !connecting && onClose()}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[440px] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
      >
        <h2 className="mb-4 text-base font-semibold text-neutral-100">
          新建 SSH 会话
        </h2>

        <fieldset disabled={connecting} className="space-y-3 text-sm">
          <Field label="名称（可选）">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：生产服务器"
              className={inputCls}
            />
          </Field>
          <div className="flex gap-2">
            <Field label="主机" className="flex-1">
              <input
                ref={hostRef}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="1.2.3.4 或 hostname"
                className={inputCls}
              />
            </Field>
            <Field label="端口" className="w-24">
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="用户名">
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="root"
              className={inputCls}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </Field>

          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
              认证方式
            </div>
            <div className="flex rounded border border-neutral-700 p-0.5">
              <TabBtn
                active={authMode === "password"}
                onClick={() => setAuthMode("password")}
              >
                密码
              </TabBtn>
              <TabBtn
                active={authMode === "private_key"}
                onClick={() => setAuthMode("private_key")}
              >
                私钥
              </TabBtn>
            </div>
          </div>

          {authMode === "password" ? (
            <Field label="密码">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </Field>
          ) : (
            <>
              {savedKeys.length > 0 && (
                <div className="flex rounded border border-neutral-700 p-0.5">
                  <TabBtn
                    active={keySource === "saved"}
                    onClick={() => setKeySource("saved")}
                  >
                    选择已保存
                  </TabBtn>
                  <TabBtn
                    active={keySource === "manual"}
                    onClick={() => setKeySource("manual")}
                  >
                    手动输入路径
                  </TabBtn>
                </div>
              )}

              {keySource === "saved" && savedKeys.length > 0 ? (
                <Field label="选择密钥">
                  <select
                    value={selectedKeyId}
                    onChange={(e) => setSelectedKeyId(e.target.value)}
                    className={inputCls}
                  >
                    {savedKeys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name} — {k.path}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="私钥文件">
                  <div className="flex gap-2">
                    <input
                      value={keyPath}
                      onChange={(e) => setKeyPath(e.target.value)}
                      placeholder="~/.ssh/id_rsa"
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={pickKeyFile}
                      className="shrink-0 rounded border border-neutral-700 px-2.5 text-xs text-neutral-300 hover:bg-neutral-800"
                    >
                      浏览…
                    </button>
                  </div>
                </Field>
              )}

              <Field label="密码短语（可选）">
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={
                    keySource === "saved"
                      ? "留空会尝试使用密钥管理里保存的密码短语"
                      : "仅加密私钥需要"
                  }
                  className={inputCls}
                />
              </Field>
              <p className="text-xs text-neutral-500">
                请选择<strong className="text-neutral-300">私钥</strong>（例如 <code>id_ed25519</code>），而不是 <code>.pub</code> 公钥。支持 OpenSSH / RSA / ED25519 / ECDSA。
              </p>
            </>
          )}

          <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            记住{authMode === "password" ? "密码" : "密码短语"}（保存到本地应用目录）
          </label>

          <Field label="分组">
            <GroupSelect value={groupId} onChange={setGroupId} />
          </Field>
        </fieldset>

        {error && (
          <div className="mt-3 rounded border border-red-900/50 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            disabled={connecting}
            onClick={() => {
              addLocal();
              reset();
              onClose();
            }}
            className="text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-40"
          >
            创建本地终端
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={connecting}
              onClick={() => {
                reset();
                onClose();
              }}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={connecting}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {connecting ? "连接中…" : "连接"}
            </button>
          </div>
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
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded py-1 text-xs font-medium",
        active
          ? "bg-neutral-800 text-neutral-100"
          : "text-neutral-400 hover:text-neutral-200",
      )}
    >
      {children}
    </button>
  );
}
