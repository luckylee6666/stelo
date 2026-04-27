use tauri::{AppHandle, State};
use zeroize::Zeroize;

use crate::audit;
use crate::credentials;
use crate::forward::{self, ForwardRegistry, ForwardRule};
use crate::sessions_store::{
    self, SavedAiProvider, SavedGroup, SavedHistoryItem, SavedKey, SavedSession, SavedSnippet,
};
use crate::known_hosts::{self, KnownHostEntry};
use crate::sftp;
use crate::ssh::{self, SshConnectConfig, SshRegistry, SudoResult};

/// 扁平化 anyhow 错误链为单个字符串，且**去掉重复的段**。
/// russh-sftp 的 `Error::Status` Display 会同时打出 status 和 message，二者字面相同时
/// 单段就成了 `"Permission denied: Permission denied"`；再叠加 source 层的同名重复，
/// 默认 `{e:#}` 会打成 `... failed: Permission denied: Permission denied: Permission denied`。
fn fmt_err(err: anyhow::Error) -> String {
    let mut parts: Vec<String> = Vec::new();
    for cause in err.chain() {
        let raw = cause.to_string();
        // 先折叠单段内的 "X: X" 自我重复
        let s = match raw.split_once(": ") {
            Some((a, b)) if a == b => a.to_string(),
            _ => raw,
        };
        if parts.last().map(|p| p == &s).unwrap_or(false) {
            continue;
        }
        // 下游完全包含时也跳过（避免 "foo: bar" 后又接 "bar"）
        if parts.last().map(|p| p.contains(&s)).unwrap_or(false) {
            continue;
        }
        parts.push(s);
    }
    parts.join(": ")
}

#[tauri::command]
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ssh_connect(
    app: AppHandle,
    registry: State<'_, SshRegistry>,
    config: SshConnectConfig,
) -> Result<String, String> {
    let target = format!("{}@{}:{}", config.user, config.host, config.port);
    let res = ssh::connect(app.clone(), registry.sessions(), config)
        .await
        .map_err(fmt_err);
    audit::log(&app, "ssh_connect", &target, res.is_ok());
    res
}

#[tauri::command(rename_all = "camelCase")]
pub fn ssh_send(
    registry: State<'_, SshRegistry>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    ssh::send(registry.sessions(), &session_id, data.into_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn ssh_resize(
    registry: State<'_, SshRegistry>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    ssh::resize(registry.sessions(), &session_id, cols, rows).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn ssh_disconnect(
    registry: State<'_, SshRegistry>,
    session_id: String,
) -> Result<(), String> {
    ssh::disconnect(registry.sessions(), &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sessions_load(app: AppHandle) -> Result<Vec<SavedSession>, String> {
    sessions_store::load(&app).map_err(fmt_err)
}

#[tauri::command]
pub fn sessions_save(app: AppHandle, sessions: Vec<SavedSession>) -> Result<(), String> {
    sessions_store::save(&app, &sessions).map_err(fmt_err)
}

#[tauri::command]
pub fn keys_load(app: AppHandle) -> Result<Vec<SavedKey>, String> {
    sessions_store::load_keys(&app).map_err(fmt_err)
}

#[tauri::command]
pub fn keys_save(app: AppHandle, keys: Vec<SavedKey>) -> Result<(), String> {
    sessions_store::save_keys(&app, &keys).map_err(fmt_err)
}

#[tauri::command]
pub fn groups_load(app: AppHandle) -> Result<Vec<SavedGroup>, String> {
    sessions_store::load_groups(&app).map_err(fmt_err)
}

#[tauri::command]
pub fn groups_save(app: AppHandle, groups: Vec<SavedGroup>) -> Result<(), String> {
    sessions_store::save_groups(&app, &groups).map_err(fmt_err)
}

#[tauri::command]
pub fn snippets_load(app: AppHandle) -> Result<Vec<SavedSnippet>, String> {
    sessions_store::load_snippets(&app).map_err(fmt_err)
}

#[tauri::command]
pub fn snippets_save(app: AppHandle, snippets: Vec<SavedSnippet>) -> Result<(), String> {
    sessions_store::save_snippets(&app, &snippets).map_err(fmt_err)
}

#[tauri::command]
pub fn history_load(app: AppHandle) -> Result<Vec<SavedHistoryItem>, String> {
    sessions_store::load_history(&app).map_err(fmt_err)
}

#[tauri::command]
pub fn history_save(app: AppHandle, items: Vec<SavedHistoryItem>) -> Result<(), String> {
    sessions_store::save_history(&app, &items).map_err(fmt_err)
}

#[tauri::command]
pub fn ai_providers_load(app: AppHandle) -> Result<Vec<SavedAiProvider>, String> {
    sessions_store::load_ai_providers(&app).map_err(fmt_err)
}

#[tauri::command]
pub fn ai_providers_save(
    app: AppHandle,
    providers: Vec<SavedAiProvider>,
) -> Result<(), String> {
    sessions_store::save_ai_providers(&app, &providers).map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn forward_start(
    app: AppHandle,
    ssh_reg: State<'_, SshRegistry>,
    fw_reg: State<'_, ForwardRegistry>,
    session_id: String,
    rule: ForwardRule,
) -> Result<(), String> {
    let ssh_handle =
        ssh::ssh_handle(ssh_reg.sessions(), &session_id).map_err(|e| e.to_string())?;
    forward::start(app, ssh_handle, session_id, rule, fw_reg.rules())
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub fn forward_stop(
    fw_reg: State<'_, ForwardRegistry>,
    rule_id: String,
) -> Result<(), String> {
    forward::stop(fw_reg.rules(), &rule_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn credential_save(
    app: AppHandle,
    account: String,
    mut secret: String,
) -> Result<(), String> {
    let res = credentials::save(&app, &account, &secret).map_err(fmt_err);
    secret.zeroize();
    audit::log(&app, "credential_save", &account, res.is_ok());
    res
}

#[tauri::command(rename_all = "camelCase")]
pub fn credential_load(app: AppHandle, account: String) -> Result<Option<String>, String> {
    // 速率限制：60s / account 上限 6 次。XSS 即使能调 invoke 也不能快速 siphon。
    if let Err(e) = audit::check_credential_rate(&account) {
        audit::log(&app, "credential_rate_block", &account, false);
        return Err(format!("{:#}", e));
    }
    // 注意：返回 String 后由 IPC 层序列化到前端，无法保证内存清零；
    // 这是 Tauri IPC 边界的固有限制，前端拿到后建议立刻交给 ssh_connect/sftp 等再用即焚。
    let res = credentials::load(&app, &account).map_err(fmt_err);
    audit::log(&app, "credential_load", &account, res.is_ok());
    res
}

#[tauri::command(rename_all = "camelCase")]
pub fn credential_delete(app: AppHandle, account: String) -> Result<(), String> {
    let res = credentials::delete(&app, &account).map_err(fmt_err);
    audit::log(&app, "credential_delete", &account, res.is_ok());
    res
}

#[tauri::command(rename_all = "camelCase")]
pub fn known_hosts_list(app: AppHandle) -> Result<Vec<KnownHostEntry>, String> {
    known_hosts::list(&app).map_err(|e| format!("{e:#}"))
}

/// 校验配置备份文件路径：只允许 .json 后缀、绝对路径、且不落在敏感目录里。
/// 这条命令存在的唯一目的就是 ConfigBackupDialog 的导入/导出，**不能**被前端用作通用 read/write。
fn validate_backup_path(raw: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::Path::new(raw);
    if !p.is_absolute() {
        return Err("路径必须是绝对路径".into());
    }
    if raw.contains("..") {
        return Err("路径不能包含 ..".into());
    }
    let lower = raw.to_lowercase();
    let ext_ok = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("json"))
        .unwrap_or(false);
    if !ext_ok {
        return Err("仅支持 .json 文件".into());
    }
    // 黑名单：典型敏感目录/文件名。即使前端被注入也别让它读 ~/.ssh、~/.aws 等
    const FORBIDDEN: &[&str] = &[
        "/.ssh/",
        "/.aws/",
        "/.gnupg/",
        "/.config/gh/",
        "/library/keychains/",
        "/etc/",
        "credentials.json", // Stelo 自己的凭据文件
        "known_hosts.json",
    ];
    for needle in FORBIDDEN {
        if lower.contains(needle) {
            return Err(format!("禁止读写敏感路径：{}", needle));
        }
    }
    Ok(p.to_path_buf())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_export_file(
    app: AppHandle,
    path: String,
    prefs: serde_json::Value,
) -> Result<(), String> {
    let target = validate_backup_path(&path)?;
    let bundle = config_export(app, prefs)?;
    let text = serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())?;
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&target, text)
        .map_err(|e| format!("write {} failed: {}", target.display(), e))
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_import_file(app: AppHandle, path: String) -> Result<serde_json::Value, String> {
    let source = validate_backup_path(&path)?;
    let text = std::fs::read_to_string(&source)
        .map_err(|e| format!("read {} failed: {}", source.display(), e))?;
    let bundle: ConfigBundle = serde_json::from_str(&text)
        .map_err(|e| format!("parse {} failed: {}", source.display(), e))?;
    let prefs = bundle.prefs.clone();
    config_import(app, bundle)?;
    Ok(prefs)
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigBundle {
    pub schema_version: u32,
    pub exported_at: i64,
    pub sessions: Vec<SavedSession>,
    pub groups: Vec<SavedGroup>,
    pub keys: Vec<SavedKey>,
    pub snippets: Vec<SavedSnippet>,
    pub ai_providers: Vec<SavedAiProvider>,
    pub history: Vec<SavedHistoryItem>,
    pub known_hosts: Vec<KnownHostEntry>,
    /// 端上 localStorage 里的 preferences（主题、字体、面板状态等）。前端传进来。
    pub prefs: serde_json::Value,
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_export(app: AppHandle, prefs: serde_json::Value) -> Result<ConfigBundle, String> {
    let sessions = sessions_store::load(&app).map_err(|e| format!("{e:#}"))?;
    let groups = sessions_store::load_groups(&app).map_err(|e| format!("{e:#}"))?;
    let keys = sessions_store::load_keys(&app).map_err(|e| format!("{e:#}"))?;
    let snippets = sessions_store::load_snippets(&app).map_err(|e| format!("{e:#}"))?;
    let ai_providers = sessions_store::load_ai_providers(&app).map_err(|e| format!("{e:#}"))?;
    let history = sessions_store::load_history(&app).map_err(|e| format!("{e:#}"))?;
    let known = known_hosts::list(&app).map_err(|e| format!("{e:#}"))?;
    Ok(ConfigBundle {
        schema_version: 1,
        exported_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
        sessions,
        groups,
        keys,
        snippets,
        ai_providers,
        history,
        known_hosts: known,
        prefs,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_import(app: AppHandle, bundle: ConfigBundle) -> Result<(), String> {
    // 简单策略：全量覆盖；需保留老数据请让用户先手动 export 备份。
    sessions_store::save(&app, &bundle.sessions).map_err(|e| format!("{e:#}"))?;
    sessions_store::save_groups(&app, &bundle.groups).map_err(|e| format!("{e:#}"))?;
    sessions_store::save_keys(&app, &bundle.keys).map_err(|e| format!("{e:#}"))?;
    sessions_store::save_snippets(&app, &bundle.snippets).map_err(|e| format!("{e:#}"))?;
    sessions_store::save_ai_providers(&app, &bundle.ai_providers).map_err(|e| format!("{e:#}"))?;
    sessions_store::save_history(&app, &bundle.history).map_err(|e| format!("{e:#}"))?;
    for kh in &bundle.known_hosts {
        known_hosts::upsert(
            &app,
            &kh.host,
            kh.port,
            kh.info.key_type.clone(),
            kh.info.fingerprint.clone(),
        )
        .map_err(|e| format!("{e:#}"))?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn known_hosts_remove(app: AppHandle, host: String, port: u16) -> Result<(), String> {
    known_hosts::remove(&app, &host, port).map_err(|e| format!("{e:#}"))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ssh_exec_sudo(
    registry: State<'_, SshRegistry>,
    session_id: String,
    password: String,
    command: String,
) -> Result<SudoResult, String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    ssh::exec_sudo(handle, password, command).await.map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_upload(
    app: AppHandle,
    registry: State<'_, SshRegistry>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::upload(app, handle, session_id, local_path, remote_path)
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_upload_with_sudo(
    app: AppHandle,
    registry: State<'_, SshRegistry>,
    session_id: String,
    local_path: String,
    remote_path: String,
    password: String,
) -> Result<String, String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::upload_with_sudo(app, handle, session_id, local_path, remote_path, password)
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_upload_dir(
    app: AppHandle,
    registry: State<'_, SshRegistry>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::upload_dir(app, handle, session_id, local_path, remote_path)
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_list(
    registry: State<'_, SshRegistry>,
    session_id: String,
    path: String,
) -> Result<Vec<sftp::Entry>, String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::list(handle, path)
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_download(
    app: AppHandle,
    registry: State<'_, SshRegistry>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<String, String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::download(app, handle, session_id, remote_path, local_path)
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_read(
    registry: State<'_, SshRegistry>,
    session_id: String,
    remote_path: String,
) -> Result<String, String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::read_text(handle, remote_path)
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_write(
    registry: State<'_, SshRegistry>,
    session_id: String,
    remote_path: String,
    content: String,
) -> Result<(), String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::write_text(handle, remote_path, content)
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_write_bytes(
    registry: State<'_, SshRegistry>,
    session_id: String,
    remote_path: String,
    content_b64: String,
) -> Result<(), String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::write_bytes_b64(handle, remote_path, content_b64)
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_read_bytes(
    registry: State<'_, SshRegistry>,
    session_id: String,
    remote_path: String,
) -> Result<String, String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::read_bytes_b64(handle, remote_path)
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_delete(
    registry: State<'_, SshRegistry>,
    session_id: String,
    remote_path: String,
) -> Result<(), String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::delete(handle, remote_path)
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_mkdir(
    registry: State<'_, SshRegistry>,
    session_id: String,
    remote_path: String,
) -> Result<(), String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::mkdir(handle, remote_path)
        .await
        .map_err(fmt_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sftp_rename(
    registry: State<'_, SshRegistry>,
    session_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let handle = ssh::ssh_handle(registry.sessions(), &session_id).map_err(|e| e.to_string())?;
    sftp::rename(handle, from, to)
        .await
        .map_err(fmt_err)
}

#[cfg(test)]
mod backup_path_tests {
    use super::validate_backup_path;

    #[test]
    fn accepts_absolute_json_in_home() {
        assert!(validate_backup_path("/Users/anyone/Desktop/stelo-config.json").is_ok());
    }

    #[test]
    fn rejects_relative_path() {
        assert!(validate_backup_path("./foo.json").is_err());
        assert!(validate_backup_path("foo.json").is_err());
    }

    #[test]
    fn rejects_dotdot_traversal() {
        assert!(validate_backup_path("/Users/anyone/../etc/passwd.json").is_err());
    }

    #[test]
    fn rejects_non_json_extension() {
        assert!(validate_backup_path("/Users/anyone/.ssh/id_rsa").is_err());
        assert!(validate_backup_path("/tmp/foo.txt").is_err());
        assert!(validate_backup_path("/tmp/foo").is_err());
    }

    #[test]
    fn rejects_dotssh_aws_gnupg_dirs() {
        assert!(validate_backup_path("/Users/anyone/.ssh/foo.json").is_err());
        assert!(validate_backup_path("/Users/anyone/.aws/credentials.json").is_err());
        assert!(validate_backup_path("/Users/anyone/.gnupg/foo.json").is_err());
    }

    #[test]
    fn rejects_keychains_and_etc() {
        assert!(
            validate_backup_path("/Users/anyone/Library/Keychains/login.json").is_err()
        );
        assert!(validate_backup_path("/etc/foo.json").is_err());
    }

    #[test]
    fn rejects_stelo_internal_files() {
        assert!(validate_backup_path("/tmp/credentials.json").is_err());
        assert!(validate_backup_path("/tmp/known_hosts.json").is_err());
    }

    #[test]
    fn case_insensitive_extension() {
        assert!(validate_backup_path("/Users/x/Backups/STELO.JSON").is_ok());
    }
}
