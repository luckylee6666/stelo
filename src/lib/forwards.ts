import { invoke } from "@tauri-apps/api/core";
import type { PortForward, Session } from "../stores/sessions";

export async function startForwardsForSession(session: Session): Promise<void> {
  const list = session.portForwards?.filter((pf) => pf.enabled) ?? [];
  for (const pf of list) {
    try {
      await invoke("forward_start", {
        sessionId: session.id,
        rule: {
          id: pf.id,
          kind: pf.kind,
          local_host: pf.localHost,
          local_port: pf.localPort,
          remote_host: pf.remoteHost,
          remote_port: pf.remotePort,
        },
      });
    } catch (e) {
      console.error(`forward_start failed for ${pf.id}:`, e);
    }
  }
}

export async function stopForwardsForSession(session: Session): Promise<void> {
  const list = session.portForwards ?? [];
  for (const pf of list) {
    try {
      await invoke("forward_stop", { ruleId: pf.id });
    } catch {
      /* ignore */
    }
  }
}

export function newForwardId(): string {
  return `pf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export function defaultForward(): PortForward {
  return {
    id: newForwardId(),
    kind: "local",
    localHost: "127.0.0.1",
    localPort: 0,
    remoteHost: "127.0.0.1",
    remotePort: 0,
    enabled: true,
  };
}
