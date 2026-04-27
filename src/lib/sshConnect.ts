import { invoke } from "@tauri-apps/api/core";

export type HostKeyMismatch = {
  host: string;
  port: number;
  expected_fingerprint: string;
  expected_key_type: string;
  got_fingerprint: string;
  got_key_type: string;
};

export type HostKeyUnverified = {
  host: string;
  port: number;
  fingerprint: string;
  key_type: string;
};

export type HostKeyChallenge =
  | { kind: "mismatch"; info: HostKeyMismatch }
  | { kind: "unverified"; info: HostKeyUnverified };

/** 调用方在事件 detail 上拿到这个 resolver 决定是否信任并重连 */
export type ChallengeResolver = (trustNew: boolean) => void;
export type MismatchResolver = ChallengeResolver;

const MISMATCH_PREFIX = "HOSTKEY_MISMATCH ";
const UNVERIFIED_PREFIX = "HOSTKEY_UNVERIFIED ";

function parseChallenge(errMsg: string): HostKeyChallenge | null {
  const mm = errMsg.indexOf(MISMATCH_PREFIX);
  if (mm >= 0) {
    try {
      return {
        kind: "mismatch",
        info: JSON.parse(errMsg.slice(mm + MISMATCH_PREFIX.length).trim()),
      };
    } catch {
      return null;
    }
  }
  const uv = errMsg.indexOf(UNVERIFIED_PREFIX);
  if (uv >= 0) {
    try {
      return {
        kind: "unverified",
        info: JSON.parse(errMsg.slice(uv + UNVERIFIED_PREFIX.length).trim()),
      };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 封装 `ssh_connect` 调用：
 *  - HOSTKEY_UNVERIFIED：首次连接此主机 → 弹"是否信任此指纹"对话框
 *  - HOSTKEY_MISMATCH：指纹与历史记录不一致 → 弹红色警告对话框
 * 用户同意则设置 trustNewHostKey=true 重试一次，否则抛"用户取消"。
 */
export async function sshConnect(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>,
): Promise<string> {
  try {
    return await invoke<string>("ssh_connect", { config });
  } catch (e) {
    const msg = String(e);
    const challenge = parseChallenge(msg);
    if (!challenge) throw e;
    const trust = await new Promise<boolean>((resolve) => {
      window.dispatchEvent(
        new CustomEvent("hyper:hostkey-challenge", {
          detail: { challenge, resolve: resolve as ChallengeResolver },
        }),
      );
    });
    if (!trust) {
      throw new Error(
        challenge.kind === "mismatch"
          ? "已取消连接（主机密钥与历史记录不匹配）"
          : "已取消连接（首次连接此主机，未确认指纹）",
      );
    }
    return await invoke<string>("ssh_connect", {
      config: { ...config, trustNewHostKey: true },
    });
  }
}
