use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSession {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// "password" | "private_key"
    pub auth_mode: String,
    #[serde(default)]
    pub key_path: Option<String>,
    /// 引用密钥库中的 key id（优先于 key_path）
    #[serde(default)]
    pub key_id: Option<String>,
    /// 所属分组
    #[serde(default)]
    pub group_id: Option<String>,
    /// 端口转发规则
    #[serde(default)]
    pub port_forwards: Vec<SavedPortForward>,
    /// 颜色标签（red / orange / yellow / green / blue / purple 等）
    #[serde(default)]
    pub color_label: Option<String>,
    /// 是否参与"多会话同步输入"
    #[serde(default)]
    pub sync_input: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedPortForward {
    pub id: String,
    pub kind: String,
    pub local_host: String,
    pub local_port: u16,
    #[serde(default)]
    pub remote_host: Option<String>,
    #[serde(default)]
    pub remote_port: Option<u16>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedKey {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSnippet {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub use_count: u32,
    #[serde(default)]
    pub last_used_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedHistoryItem {
    pub command: String,
    pub count: u32,
    pub last_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedAiProvider {
    pub id: String,
    pub name: String,
    /// "claude" | "openai"
    pub kind: String,
    pub api_base: String,
    pub model: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

fn default_max_tokens() -> u32 {
    1024
}

fn data_file(app: &AppHandle, name: &str) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("resolve app_data_dir failed")?;
    fs::create_dir_all(&dir).ok();
    Ok(dir.join(name))
}

fn sessions_file(app: &AppHandle) -> Result<PathBuf> {
    data_file(app, "sessions.json")
}

pub fn load(app: &AppHandle) -> Result<Vec<SavedSession>> {
    let file = sessions_file(app)?;
    if !file.exists() {
        return Ok(vec![]);
    }
    let text = fs::read_to_string(&file)
        .with_context(|| format!("read {} failed", file.display()))?;
    if text.trim().is_empty() {
        return Ok(vec![]);
    }
    let list: Vec<SavedSession> = serde_json::from_str(&text)
        .with_context(|| format!("parse {} failed", file.display()))?;
    Ok(list)
}

pub fn save(app: &AppHandle, sessions: &[SavedSession]) -> Result<()> {
    write_json(sessions_file(app)?, sessions)
}

fn write_json<T: serde::Serialize + ?Sized>(file: PathBuf, v: &T) -> Result<()> {
    let text = serde_json::to_string_pretty(v)?;
    let tmp = file.with_extension("json.tmp");

    // 即使没有"密码"也别让其他用户读：sessions.json 暴露 user@host 列表，
    // history.json 可能含敏感命令参数。chmod 600 跟 credentials.json 一致。
    // 用 OpenOptions + fd-level chmod，无 TOCTOU 窗口（先 write 再 set_permissions 会留下短暂的可读窗口）。
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp)
            .with_context(|| format!("open {} failed", tmp.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = f.set_permissions(fs::Permissions::from_mode(0o600));
        }
        f.write_all(text.as_bytes())
            .with_context(|| format!("write {} failed", tmp.display()))?;
    }

    fs::rename(&tmp, &file).with_context(|| format!("rename to {} failed", file.display()))?;
    Ok(())
}

fn read_json<T: serde::de::DeserializeOwned + Default>(file: PathBuf) -> Result<T> {
    if !file.exists() {
        return Ok(T::default());
    }
    let text = fs::read_to_string(&file)
        .with_context(|| format!("read {} failed", file.display()))?;
    if text.trim().is_empty() {
        return Ok(T::default());
    }
    serde_json::from_str(&text)
        .with_context(|| format!("parse {} failed", file.display()))
}

pub fn load_keys(app: &AppHandle) -> Result<Vec<SavedKey>> {
    read_json(data_file(app, "keys.json")?)
}

pub fn save_keys(app: &AppHandle, keys: &[SavedKey]) -> Result<()> {
    write_json(data_file(app, "keys.json")?, keys)
}

pub fn load_groups(app: &AppHandle) -> Result<Vec<SavedGroup>> {
    read_json(data_file(app, "groups.json")?)
}

pub fn save_groups(app: &AppHandle, groups: &[SavedGroup]) -> Result<()> {
    write_json(data_file(app, "groups.json")?, groups)
}

pub fn load_snippets(app: &AppHandle) -> Result<Vec<SavedSnippet>> {
    read_json(data_file(app, "snippets.json")?)
}

pub fn save_snippets(app: &AppHandle, snippets: &[SavedSnippet]) -> Result<()> {
    write_json(data_file(app, "snippets.json")?, snippets)
}

pub fn load_history(app: &AppHandle) -> Result<Vec<SavedHistoryItem>> {
    read_json(data_file(app, "history.json")?)
}

pub fn save_history(app: &AppHandle, items: &[SavedHistoryItem]) -> Result<()> {
    write_json(data_file(app, "history.json")?, items)
}

pub fn load_ai_providers(app: &AppHandle) -> Result<Vec<SavedAiProvider>> {
    read_json(data_file(app, "ai_providers.json")?)
}

pub fn save_ai_providers(app: &AppHandle, list: &[SavedAiProvider]) -> Result<()> {
    write_json(data_file(app, "ai_providers.json")?, list)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn empty_file_returns_default() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("sessions.json");
        let sessions: Vec<SavedSession> = read_json(file).unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn whitespace_file_returns_default() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("sessions.json");
        fs::write(&file, "   \n  ").unwrap();
        let sessions: Vec<SavedSession> = read_json(file).unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn session_roundtrip_preserves_all_fields() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("sessions.json");
        let sessions = vec![SavedSession {
            id: "sess-1".into(),
            name: "prod-web".into(),
            host: "82.156.196.149".into(),
            port: 22,
            user: "root".into(),
            auth_mode: "private_key".into(),
            key_path: Some("~/.ssh/id_ed25519".into()),
            key_id: Some("k-1".into()),
            group_id: Some("g-1".into()),
            port_forwards: vec![SavedPortForward {
                id: "f-1".into(),
                kind: "local".into(),
                local_host: "127.0.0.1".into(),
                local_port: 3307,
                remote_host: Some("127.0.0.1".into()),
                remote_port: Some(3306),
                enabled: true,
            }],
            color_label: Some("blue".into()),
            sync_input: true,
        }];
        write_json(file.clone(), &sessions).unwrap();
        let loaded: Vec<SavedSession> = read_json(file).unwrap();
        assert_eq!(loaded.len(), 1);
        let s = &loaded[0];
        assert_eq!(s.id, "sess-1");
        assert_eq!(s.port, 22);
        assert_eq!(s.auth_mode, "private_key");
        assert_eq!(s.key_id.as_deref(), Some("k-1"));
        assert_eq!(s.group_id.as_deref(), Some("g-1"));
        assert_eq!(s.port_forwards.len(), 1);
        assert_eq!(s.port_forwards[0].local_port, 3307);
        assert_eq!(s.color_label.as_deref(), Some("blue"));
        assert!(s.sync_input);
    }

    #[test]
    fn session_minimal_json_uses_defaults() {
        // 缺省 key_path / key_id / group_id / port_forwards / color_label / sync_input
        let dir = tempdir().unwrap();
        let file = dir.path().join("sessions.json");
        fs::write(
            &file,
            r#"[{"id":"a","name":"n","host":"h","port":22,"user":"u","auth_mode":"password"}]"#,
        )
        .unwrap();
        let loaded: Vec<SavedSession> = read_json(file).unwrap();
        assert_eq!(loaded.len(), 1);
        let s = &loaded[0];
        assert!(s.key_path.is_none());
        assert!(s.key_id.is_none());
        assert!(s.group_id.is_none());
        assert!(s.port_forwards.is_empty());
        assert!(s.color_label.is_none());
        assert!(!s.sync_input);
    }

    #[test]
    fn ai_provider_default_max_tokens() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("ai.json");
        fs::write(
            &file,
            r#"[{"id":"p","name":"Claude","kind":"claude","api_base":"https://api.anthropic.com","model":"claude-sonnet-4-5"}]"#,
        )
        .unwrap();
        let loaded: Vec<SavedAiProvider> = read_json(file).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].max_tokens, 1024);
    }

    #[test]
    fn snippet_default_counters() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("sn.json");
        fs::write(
            &file,
            r#"[{"id":"s","name":"ll","command":"ls -la"}]"#,
        )
        .unwrap();
        let loaded: Vec<SavedSnippet> = read_json(file).unwrap();
        assert_eq!(loaded[0].use_count, 0);
        assert_eq!(loaded[0].last_used_at, 0);
    }

    #[test]
    fn group_default_order() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("g.json");
        fs::write(&file, r#"[{"id":"g","name":"prod"}]"#).unwrap();
        let loaded: Vec<SavedGroup> = read_json(file).unwrap();
        assert_eq!(loaded[0].order, 0);
    }

    #[cfg(unix)]
    #[test]
    fn write_json_sets_0600_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let file = dir.path().join("history.json");
        let items = vec![SavedHistoryItem {
            command: "ls".into(),
            count: 1,
            last_at: 0,
        }];
        write_json(file.clone(), &items).unwrap();
        let mode = fs::metadata(&file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "json data files must be chmod 600");
    }

    #[test]
    fn write_json_is_atomic_via_tmp_rename() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("k.json");
        fs::write(&file, r#"[{"id":"old","name":"old","path":"/old"}]"#).unwrap();
        let new_list = vec![SavedKey {
            id: "new".into(),
            name: "new".into(),
            path: "/new".into(),
        }];
        write_json(file.clone(), &new_list).unwrap();
        // 中间不应该残留 .tmp
        let tmp = file.with_extension("json.tmp");
        assert!(!tmp.exists(), "tmp file should be renamed away");
        let loaded: Vec<SavedKey> = read_json(file).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "new");
    }
}
