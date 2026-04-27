use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// 单条 known_hosts 记录——按 host:port 键存。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownHost {
    /// "ssh-ed25519" / "ssh-rsa" / "ecdsa-sha2-nistp256" 等
    pub key_type: String,
    /// 形如 "SHA256:xxxxxxx…"（与 `ssh-keygen -lf` 一致）
    pub fingerprint: String,
    /// 首次记录的 unix 秒
    pub first_seen: i64,
}

type Store = BTreeMap<String, KnownHost>;

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn file_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("resolve app_data_dir failed")?;
    fs::create_dir_all(&dir).ok();
    Ok(dir.join("known_hosts.json"))
}

fn key(host: &str, port: u16) -> String {
    format!("{}:{}", host, port)
}

fn load_at(file: &Path) -> Result<Store> {
    if !file.exists() {
        return Ok(Store::new());
    }
    let text = fs::read_to_string(file)
        .with_context(|| format!("read {} failed", file.display()))?;
    if text.trim().is_empty() {
        return Ok(Store::new());
    }
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

fn save_at(file: &Path, store: &Store) -> Result<()> {
    let text = serde_json::to_string_pretty(store)?;
    let tmp = file.with_extension("json.tmp");
    // fd-level chmod 无 TOCTOU
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
    fs::rename(&tmp, file)
        .with_context(|| format!("rename to {} failed", file.display()))?;
    Ok(())
}

pub fn get(app: &AppHandle, host: &str, port: u16) -> Result<Option<KnownHost>> {
    let s = load_at(&file_path(app)?)?;
    Ok(s.get(&key(host, port)).cloned())
}

pub fn upsert(
    app: &AppHandle,
    host: &str,
    port: u16,
    key_type: String,
    fingerprint: String,
) -> Result<()> {
    let file = file_path(app)?;
    let mut s = load_at(&file)?;
    // 只有真正新增时才更新 first_seen；已存在就覆盖 fingerprint/key_type（替换密钥）但保留首见时间
    let entry = match s.get(&key(host, port)) {
        Some(old) => KnownHost {
            key_type,
            fingerprint,
            first_seen: old.first_seen,
        },
        None => KnownHost {
            key_type,
            fingerprint,
            first_seen: now_ts(),
        },
    };
    s.insert(key(host, port), entry);
    save_at(&file, &s)
}

pub fn remove(app: &AppHandle, host: &str, port: u16) -> Result<()> {
    let file = file_path(app)?;
    let mut s = load_at(&file)?;
    s.remove(&key(host, port));
    save_at(&file, &s)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KnownHostEntry {
    pub host: String,
    pub port: u16,
    #[serde(flatten)]
    pub info: KnownHost,
}

pub fn list(app: &AppHandle) -> Result<Vec<KnownHostEntry>> {
    let s = load_at(&file_path(app)?)?;
    Ok(s.into_iter()
        .filter_map(|(k, info)| {
            let (h, p) = k.rsplit_once(':')?;
            let port = p.parse().ok()?;
            Some(KnownHostEntry {
                host: h.to_string(),
                port,
                info,
            })
        })
        .collect())
}
