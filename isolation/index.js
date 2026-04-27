// Stelo Isolation Application
//
// Tauri 在主前端和 Rust core 之间插入这个 sandbox iframe（不同 origin），
// 主前端发出的每一个 IPC 都会先到这里 hook 一次。我们在这里：
//   1) 校验命令名是否在白名单里（拒绝任何不认识的命令——XSS 调不出去）
//   2) 校验关键字段（如 ssh_connect 必须含 host/user/auth）
//   3) 通过校验后透传给 core，否则 reject
//
// 注意：严禁在这里读 IPC 的 payload 内容（其它密钥/密码字段）做记录或日志，
// 否则就把 secret 暴露给 isolation 进程。只看"形状"，不看"值"。

// 主前端调用 Tauri Builder.invoke_system 的命令名必须在这里出现。
// 这是给攻击面套绳的地方——保持最小集，新增命令时同步更新。
const ALLOWED_COMMANDS = new Set([
  // 应用元信息
  "app_version",
  // SSH 终端
  "ssh_connect",
  "ssh_send",
  "ssh_exec_sudo",
  "ssh_resize",
  "ssh_disconnect",
  // Known hosts
  "known_hosts_list",
  "known_hosts_remove",
  // 配置导入导出（已限定 .json 路径白名单）
  "config_export",
  "config_import",
  "config_export_file",
  "config_import_file",
  // 会话/分组/密钥/快捷指令/历史/AI provider 元数据
  "sessions_load",
  "sessions_save",
  "groups_load",
  "groups_save",
  "keys_load",
  "keys_save",
  "snippets_load",
  "snippets_save",
  "history_load",
  "history_save",
  "ai_providers_load",
  "ai_providers_save",
  // 凭据（已 Argon2id 加密 + 速率限制 + 审计）
  "credential_save",
  "credential_load",
  "credential_delete",
  // SFTP
  "sftp_upload",
  "sftp_upload_with_sudo",
  "sftp_upload_dir",
  "sftp_list",
  "sftp_download",
  "sftp_read",
  "sftp_write",
  "sftp_write_bytes",
  "sftp_read_bytes",
  "sftp_delete",
  "sftp_mkdir",
  "sftp_rename",
  // 端口转发
  "forward_start",
  "forward_stop",
  // tauri-plugin-* 内置命令（dialog / opener / http 等）以 plugin: 前缀进入，跳过校验
]);

// payload 形状校验：只看 key 是否存在，不看 value。
const SHAPE_CHECKS = {
  ssh_connect: (p) => {
    const c = p?.config;
    if (!c || typeof c !== "object") return "missing config";
    if (typeof c.host !== "string" || !c.host) return "config.host invalid";
    if (typeof c.user !== "string" || !c.user) return "config.user invalid";
    if (!c.auth || typeof c.auth !== "object") return "config.auth missing";
    return null;
  },
  credential_save: (p) => {
    if (typeof p?.account !== "string") return "account must be string";
    if (typeof p?.secret !== "string") return "secret must be string";
    return null;
  },
  credential_load: (p) => {
    if (typeof p?.account !== "string") return "account must be string";
    return null;
  },
  config_export_file: (p) => {
    if (typeof p?.path !== "string") return "path must be string";
    return null;
  },
  config_import_file: (p) => {
    if (typeof p?.path !== "string") return "path must be string";
    return null;
  },
};

// Tauri 2 isolation hook：这个全局函数被 Tauri runtime 注入主前端，
// 用于在 IPC 离开主前端 webview 之前最后一次校验。
window.__TAURI_ISOLATION_HOOK__ = (payload) => {
  // payload 形如 { cmd: "ssh_connect", callback, error, ...args }
  // Tauri plugin 的命令以 "plugin:..." 形式出现，直接放行（plugin 自己有 capabilities 校验）。
  const cmd = payload?.cmd;
  if (typeof cmd !== "string") {
    // 非 IPC 形状：交给 Tauri 自己处理
    return payload;
  }
  if (cmd.startsWith("plugin:") || cmd === "tauri") {
    return payload;
  }
  if (!ALLOWED_COMMANDS.has(cmd)) {
    // 未授权命令：抛出可见错误，Tauri runtime 会把 reject 投回主前端
    throw new Error(
      `[isolation] command "${cmd}" not in allowlist — rejected by Stelo isolation layer`,
    );
  }
  const checker = SHAPE_CHECKS[cmd];
  if (checker) {
    const reason = checker(payload);
    if (reason) {
      throw new Error(`[isolation] payload shape invalid for "${cmd}": ${reason}`);
    }
  }
  return payload;
};
