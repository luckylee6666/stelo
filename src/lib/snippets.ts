import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../stores/sessions";
import { useSnippetStore } from "../stores/snippets";
import { useHistoryStore } from "../stores/history";

/** 把命令发到当前 active 会话的终端。若当前无连接则不发。
 *  snippetId 可选——若提供，会同时递增该 snippet 的使用次数。
 */
export async function sendSnippetToActive(
  command: string,
  snippetId?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const state = useSessionStore.getState();
  const active = state.sessions.find((s) => s.id === state.activeId);
  if (!active) return { ok: false, reason: "没有选中的会话" };
  if (!active.backendId)
    return { ok: false, reason: "会话未连接，双击会话先连接" };
  const data = command.endsWith("\n")
    ? command.slice(0, -1) + "\r"
    : command.endsWith("\r")
      ? command
      : command + "\r";
  try {
    await invoke("ssh_send", { sessionId: active.backendId, data });
    if (snippetId) useSnippetStore.getState().recordUse(snippetId);
    // 同时记入历史（手动执行和快捷指令执行都统计）
    useHistoryStore.getState().record(command);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}
