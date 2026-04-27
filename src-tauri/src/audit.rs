use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 本地审计日志：append-only JSONL（每行一个事件），落在 app_data_dir/audit.log。
/// chmod 600，10MB 滚动到 audit.log.1（保留 1 份）。
///
/// 用途：用户/事故响应可自查"哪天哪个时间点 credential 被读了多少次"，
/// 不上传任何地方，纯本地。
const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Serialize)]
struct Event<'a> {
    ts: i64,
    /// 事件类型：credential_load / credential_save / credential_delete /
    /// ssh_connect / hostkey_trust / sftp_upload / sftp_download / ai_call …
    kind: &'a str,
    /// 简短描述，已脱敏（绝不带 secret）
    detail: &'a str,
    /// 是否成功
    ok: bool,
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn audit_file(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("resolve app_data_dir failed")?;
    fs::create_dir_all(&dir).ok();
    Ok(dir.join("audit.log"))
}

fn rotate_if_needed(file: &Path) -> Result<()> {
    let meta = match fs::metadata(file) {
        Ok(m) => m,
        Err(_) => return Ok(()), // 不存在就不滚
    };
    if meta.len() < MAX_LOG_BYTES {
        return Ok(());
    }
    let rotated = file.with_extension("log.1");
    let _ = fs::remove_file(&rotated);
    fs::rename(file, &rotated)
        .with_context(|| format!("rotate {} failed", file.display()))?;
    Ok(())
}

fn append_line(file: &Path, line: &str) -> Result<()> {
    rotate_if_needed(file)?;
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
        .with_context(|| format!("open {} failed", file.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(file, fs::Permissions::from_mode(0o600));
    }

    f.write_all(line.as_bytes())
        .with_context(|| format!("write {} failed", file.display()))?;
    f.write_all(b"\n").ok();
    Ok(())
}

/// 写一条事件到 audit.log。失败仅 warn，不抛——审计自身不能挡功能。
pub fn log(app: &AppHandle, kind: &str, detail: &str, ok: bool) {
    let file = match audit_file(app) {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!("audit: resolve path failed: {:#}", e);
            return;
        }
    };
    let ev = Event {
        ts: now_ts(),
        kind,
        detail,
        ok,
    };
    let line = match serde_json::to_string(&ev) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("audit: serialize failed: {:#}", e);
            return;
        }
    };
    if let Err(e) = append_line(&file, &line) {
        tracing::warn!("audit: append failed: {:#}", e);
    }
}

/* ──────────────── credential_load 速率限制 ──────────────── */

const RATE_WINDOW_SECS: i64 = 60;
const RATE_MAX_HITS: usize = 6;

struct Bucket {
    /// 60s 滑动窗口内的命中时刻
    hits: Vec<i64>,
}

impl Bucket {
    fn new() -> Self {
        Self { hits: Vec::new() }
    }
    fn try_hit(&mut self, now: i64) -> bool {
        // 丢弃窗口外的旧命中
        self.hits.retain(|t| now - *t < RATE_WINDOW_SECS);
        if self.hits.len() >= RATE_MAX_HITS {
            return false;
        }
        self.hits.push(now);
        true
    }
}

static RATE_BUCKETS: Lazy<Mutex<HashMap<String, Bucket>>> = Lazy::new(Default::default);

/// credential_load 速率检查。每个 account 60 秒内 ≤ 6 次。
/// XSS 即使能调 invoke 也无法快速 siphon 所有凭据。
pub fn check_credential_rate(account: &str) -> Result<()> {
    let mut map = RATE_BUCKETS.lock().map_err(|e| anyhow!("rate lock: {e}"))?;
    let bucket = map.entry(account.to_string()).or_insert_with(Bucket::new);
    if !bucket.try_hit(now_ts()) {
        return Err(anyhow!(
            "credential rate-limited (>{} reads / {}s for one account)",
            RATE_MAX_HITS,
            RATE_WINDOW_SECS
        ));
    }
    Ok(())
}

#[cfg(test)]
pub fn reset_rate_for_tests() {
    if let Ok(mut m) = RATE_BUCKETS.lock() {
        m.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn append_writes_jsonl_lines() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("audit.log");
        append_line(&file, r#"{"ts":1,"kind":"x","detail":"d","ok":true}"#).unwrap();
        append_line(&file, r#"{"ts":2,"kind":"y","detail":"e","ok":false}"#).unwrap();
        let text = fs::read_to_string(&file).unwrap();
        assert_eq!(text.lines().count(), 2);
        assert!(text.contains("\"kind\":\"x\""));
        assert!(text.contains("\"kind\":\"y\""));
    }

    #[cfg(unix)]
    #[test]
    fn append_sets_chmod_600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let file = dir.path().join("audit.log");
        append_line(&file, "{}").unwrap();
        let mode = fs::metadata(&file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn rotation_at_threshold() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("audit.log");
        // 写一条把它撑过阈值
        let big = "x".repeat(MAX_LOG_BYTES as usize + 1);
        fs::write(&file, &big).unwrap();
        append_line(&file, "after").unwrap();
        // .log.1 是旧的；.log 是新的（只有"after\n"）
        let rotated = file.with_extension("log.1");
        assert!(rotated.exists(), "rotated file should exist");
        let new_content = fs::read_to_string(&file).unwrap();
        assert_eq!(new_content.trim(), "after");
    }

    #[test]
    fn rate_limit_allows_under_threshold() {
        reset_rate_for_tests();
        for _ in 0..RATE_MAX_HITS {
            assert!(check_credential_rate("acct-1").is_ok());
        }
    }

    #[test]
    fn rate_limit_blocks_over_threshold() {
        reset_rate_for_tests();
        for _ in 0..RATE_MAX_HITS {
            assert!(check_credential_rate("acct-2").is_ok());
        }
        // 第 7 次拒绝
        assert!(check_credential_rate("acct-2").is_err());
    }

    #[test]
    fn rate_limit_per_account_independent() {
        reset_rate_for_tests();
        for _ in 0..RATE_MAX_HITS {
            assert!(check_credential_rate("acct-A").is_ok());
        }
        // A 已满，B 还能继续
        assert!(check_credential_rate("acct-A").is_err());
        assert!(check_credential_rate("acct-B").is_ok());
    }
}
