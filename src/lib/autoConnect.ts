import { invoke } from "@tauri-apps/api/core";
import { useSessionStore, type Session } from "../stores/sessions";
import { useKeyStore } from "../stores/keys";
import { startForwardsForSession } from "./forwards";
import { sshConnect } from "./sshConnect";

type ConnectResult =
  | { ok: true }
  | { ok: false; reason: "no-credential" | "error"; message: string };

export async function autoConnect(session: Session): Promise<ConnectResult> {
  if (session.kind !== "ssh") {
    return { ok: false, reason: "error", message: "not an SSH session" };
  }
  if (session.backendId) return { ok: true };

  // 立即切到 connecting 状态，避免 UI 先渲染一帧 ReconnectPanel 再切 ConnectingView
  useSessionStore.getState().setStatus(session.id, "connecting");

  let resolvedKeyPath = session.keyPath ?? "";
  if (session.authMode === "private_key" && session.keyId) {
    const k = useKeyStore.getState().keys.find((x) => x.id === session.keyId);
    if (!k) {
      useSessionStore
        .getState()
        .setStatus(session.id, "error", `密钥引用失效: ${session.keyId}`);
      return {
        ok: false,
        reason: "error",
        message: `密钥引用失效（keyId=${session.keyId}）`,
      };
    }
    resolvedKeyPath = k.path;
  }

  // 密码模式从 session-scoped 读；密钥模式优先从 key-scoped 读，fallback session-scoped
  let saved: string | null = null;
  try {
    if (session.authMode === "password") {
      saved = await invoke<string | null>("credential_load", {
        account: `${session.id}:password`,
      });
    } else if (session.keyId) {
      saved = await invoke<string | null>("credential_load", {
        account: `key:${session.keyId}:passphrase`,
      });
      if (!saved) {
        saved = await invoke<string | null>("credential_load", {
          account: `${session.id}:passphrase`,
        });
      }
    } else {
      saved = await invoke<string | null>("credential_load", {
        account: `${session.id}:passphrase`,
      });
    }
  } catch (err) {
    console.error("credential_load failed:", err);
  }

  if (session.authMode === "password" && !saved) {
    // 回到 closed 状态，让 UI 切换到 ReconnectPanel 让用户手动输密码
    useSessionStore.getState().setStatus(session.id, "closed");
    return {
      ok: false,
      reason: "no-credential",
      message: "未保存密码，请手动输入",
    };
  }

  const auth =
    session.authMode === "password"
      ? { kind: "password", password: saved ?? "" }
      : {
          kind: "private_key",
          key_path: resolvedKeyPath,
          passphrase: saved ? saved : null,
        };

  try {
    const backendId = await sshConnect({
      host: session.host,
      port: session.port,
      user: session.user,
      auth,
      cols: 120,
      rows: 32,
    });
    useSessionStore.getState().attachBackend(session.id, backendId);
    const updated = useSessionStore
      .getState()
      .sessions.find((s) => s.id === session.id);
    if (updated) startForwardsForSession(updated).catch(() => {});
    return { ok: true };
  } catch (err) {
    const msg = String(err);
    useSessionStore.getState().setStatus(session.id, "error", msg);
    return { ok: false, reason: "error", message: msg };
  }
}
