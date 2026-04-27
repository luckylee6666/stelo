import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore, type Session } from "../stores/sessions";
import { useKeyStore } from "../stores/keys";
import { startForwardsForSession } from "../lib/forwards";
import { sshConnect } from "../lib/sshConnect";
import { diagnoseSshError } from "../lib/sshErrors";

type Props = {
  session: Session;
};

export function ReconnectPanel({ session }: Props) {
  const attachBackend = useSessionStore((s) => s.attachBackend);
  const setStatus = useSessionStore((s) => s.setStatus);
  const closeSession = useSessionStore((s) => s.closeSession);

  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(
    session.errorMsg ?? null,
  );
  const [remember, setRemember] = useState(true);
  const [credLoaded, setCredLoaded] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => firstInputRef.current?.focus(), 40);
    const tryAccounts =
      session.authMode === "password"
        ? [`${session.id}:password`]
        : session.keyId
          ? [`key:${session.keyId}:passphrase`, `${session.id}:passphrase`]
          : [`${session.id}:passphrase`];
    (async () => {
      for (const acc of tryAccounts) {
        try {
          const v = await invoke<string | null>("credential_load", {
            account: acc,
          });
          if (v) {
            if (session.authMode === "password") setPassword(v);
            else setPassphrase(v);
            setCredLoaded(true);
            break;
          }
        } catch (e) {
          console.error("credential_load failed:", e);
        }
      }
    })();
  }, [session.id, session.authMode, session.keyId]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (connecting) return;
    let kPath = session.keyPath ?? "";
    if (session.keyId) {
      const k = useKeyStore.getState().keys.find((x) => x.id === session.keyId);
      if (k) kPath = k.path;
    }
    const auth =
      session.authMode === "private_key"
        ? {
            kind: "private_key",
            key_path: kPath,
            passphrase: passphrase ? passphrase : null,
          }
        : { kind: "password", password };

    setConnecting(true);
    setError(null);
    setStatus(session.id, "connecting");
    try {
      const backendId = await sshConnect({
        host: session.host,
        port: session.port,
        user: session.user,
        auth,
        cols: 120,
        rows: 32,
      });
      attachBackend(session.id, backendId);
      const updated = useSessionStore
        .getState()
        .sessions.find((s) => s.id === session.id);
      if (updated) startForwardsForSession(updated).catch(() => {});
      const writeAccount =
        session.authMode === "password"
          ? `${session.id}:password`
          : session.keyId
            ? `key:${session.keyId}:passphrase`
            : `${session.id}:passphrase`;
      const secret = session.authMode === "password" ? password : passphrase;
      if (remember && secret) {
        invoke("credential_save", { account: writeAccount, secret }).catch(
          (e) => console.error("credential_save failed:", e),
        );
      } else if (!remember && credLoaded) {
        invoke("credential_delete", { account: writeAccount }).catch(() => {});
      }
    } catch (err) {
      setError(String(err));
      setStatus(session.id, "error", String(err));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center">
      <form
        onSubmit={submit}
        className="w-[400px] rounded-lg border border-neutral-800 bg-neutral-900 p-5"
      >
        <div className="mb-3">
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            重新连接
          </div>
          <div className="mt-0.5 truncate text-base font-semibold text-neutral-100">
            {session.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-neutral-500">
            {session.user}@{session.host}:{session.port} ·{" "}
            {session.authMode === "private_key" ? "密钥" : "密码"}
          </div>
          {session.authMode === "private_key" && session.keyPath && (
            <div className="mt-0.5 truncate text-xs text-neutral-600">
              {session.keyPath}
            </div>
          )}
        </div>

        <fieldset disabled={connecting} className="space-y-3 text-sm">
          {session.authMode === "password" ? (
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
                密码
              </span>
              <input
                ref={firstInputRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </label>
          ) : (
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
                密码短语（可选）
              </span>
              <input
                ref={firstInputRef}
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="仅加密私钥需要"
                className={inputCls}
              />
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            记住{session.authMode === "password" ? "密码" : "密码短语"}
            {credLoaded && (
              <span className="text-emerald-500">· 已加载保存的凭据</span>
            )}
          </label>
        </fieldset>

        {error && (() => {
          const diag = diagnoseSshError(error);
          return (
            <div className="mt-3 rounded border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-200">
              <div className="mb-1.5 font-semibold text-red-100">
                ⚠ {diag.title}
              </div>
              <ul className="ml-4 list-disc space-y-0.5 text-red-200/85">
                {diag.hints.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
              <details className="mt-2 text-[10px] text-red-300/60">
                <summary className="cursor-pointer hover:text-red-300">
                  原始错误信息
                </summary>
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono">
                  {diag.raw}
                </pre>
              </details>
            </div>
          );
        })()}

        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            disabled={connecting}
            onClick={() => closeSession(session.id)}
            className="text-xs text-neutral-500 hover:text-red-400 disabled:opacity-40"
          >
            删除此会话
          </button>
          <button
            type="submit"
            disabled={connecting}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {connecting ? "连接中…" : "连接"}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500";
