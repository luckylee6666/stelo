use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileType;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::info;

use crate::ssh::SshClient;

#[derive(Serialize, Clone)]
pub struct UploadProgress {
    pub local: String,
    pub remote: String,
    pub transferred: u64,
    pub total: u64,
    pub done: bool,
}

#[derive(Serialize, Clone)]
pub struct Entry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_link: bool,
    pub mtime: u64,
    pub mode: u32,
}

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    pub remote: String,
    pub local: String,
    pub transferred: u64,
    pub total: u64,
    pub done: bool,
}

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

async fn sftp(handle: &Arc<Handle<SshClient>>) -> Result<SftpSession> {
    let channel = handle
        .channel_open_session()
        .await
        .context("open sftp channel failed")?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .context("request sftp subsystem failed")?;
    let sess = SftpSession::new(channel.into_stream())
        .await
        .context("sftp session handshake failed")?;
    Ok(sess)
}

/// remote_path 可以是目录或完整路径；若是目录，自动拼接文件名。
async fn resolve_remote(
    sess: &SftpSession,
    remote: &str,
    local_name: &str,
) -> Result<String> {
    let looks_like_dir = remote.ends_with('/');
    let metadata = sess.metadata(remote).await;
    let is_dir = match &metadata {
        Ok(m) => m.is_dir(),
        Err(_) => false,
    };
    if looks_like_dir || is_dir {
        let base = remote.trim_end_matches('/');
        if base.is_empty() {
            Ok(format!("/{}", local_name))
        } else {
            Ok(format!("{}/{}", base, local_name))
        }
    } else {
        Ok(remote.to_string())
    }
}

pub async fn mkdir(handle: Arc<Handle<SshClient>>, path: String) -> Result<()> {
    let sess = sftp(&handle).await?;
    sess.create_dir(&path)
        .await
        .with_context(|| format!("mkdir {} failed", path))?;
    Ok(())
}

pub async fn rename(
    handle: Arc<Handle<SshClient>>,
    from: String,
    to: String,
) -> Result<()> {
    let sess = sftp(&handle).await?;
    sess.rename(&from, &to)
        .await
        .with_context(|| format!("rename {} -> {} failed", from, to))?;
    Ok(())
}

/// 递归创建远端目录（类似 `mkdir -p`）。已存在的目录跳过。
async fn mkdir_p(sess: &SftpSession, path: &str) -> Result<()> {
    if let Ok(m) = sess.metadata(path).await {
        if m.is_dir() {
            return Ok(());
        }
        return Err(anyhow!("{} exists but is not a directory", path));
    }
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let mut cur = if path.starts_with('/') {
        String::from("/")
    } else {
        String::new()
    };
    for part in parts {
        if !cur.is_empty() && !cur.ends_with('/') {
            cur.push('/');
        }
        cur.push_str(part);
        if sess.metadata(&cur).await.is_ok() {
            continue;
        }
        if let Err(e) = sess.create_dir(&cur).await {
            // 竞态：也许别人已经创建了
            if sess.metadata(&cur).await.is_ok() {
                continue;
            }
            return Err(anyhow!("mkdir {} failed: {}", cur, e));
        }
    }
    Ok(())
}

/// 同步收集本地目录下所有文件（相对路径）。MVP：跳过符号链接、跳过错误条目。
fn collect_files_sync(
    root: &std::path::Path,
    rel_prefix: String,
    out: &mut Vec<(PathBuf, String)>,
) -> Result<()> {
    let iter = std::fs::read_dir(root)
        .with_context(|| format!("read_dir {} failed", root.display()))?;
    for entry in iter {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if rel_prefix.is_empty() {
            name
        } else {
            format!("{}/{}", rel_prefix, name)
        };
        // 用 symlink_metadata 避免跟随符号链接导致死循环
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if md.file_type().is_symlink() {
            continue;
        }
        if md.is_dir() {
            collect_files_sync(&path, rel, out)?;
        } else if md.is_file() {
            out.push((path, rel));
        }
    }
    Ok(())
}

/// 递归上传本地目录到远端。remote_path 若以 `/` 结尾或是已有目录 → 创建子目录 local_name
/// 并在其中铺设结构；否则 remote_path 直接作为目标根目录。
pub async fn upload_dir(
    app: AppHandle,
    handle: Arc<Handle<SshClient>>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<String> {
    let local = expand_home(&local_path);
    if !local.is_dir() {
        return Err(anyhow!("not a local directory: {}", local.display()));
    }
    let local_name = local
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("cannot extract local dir name"))?
        .to_string();

    // 先扫一遍收集文件列表（阻塞 IO，目录通常不大；放到 spawn_blocking 更稳，这里 MVP 直跑）
    let mut files: Vec<(PathBuf, String)> = Vec::new();
    collect_files_sync(&local, String::new(), &mut files)?;

    let sess = sftp(&handle).await?;

    let remote_is_dir = sess.metadata(&remote_path).await.map(|m| m.is_dir()).unwrap_or(false);
    let remote_root = if remote_path.ends_with('/') || remote_is_dir {
        format!("{}/{}", remote_path.trim_end_matches('/'), local_name)
    } else {
        remote_path.clone()
    };
    mkdir_p(&sess, &remote_root).await?;

    info!(
        "sftp upload_dir: {} -> {} ({} files)",
        local.display(),
        remote_root,
        files.len()
    );

    let event = format!("sftp:progress:{}", session_id);
    let total_files = files.len();
    for (i, (local_file, rel)) in files.iter().enumerate() {
        let remote_file = format!("{}/{}", remote_root, rel);
        if let Some(slash) = remote_file.rfind('/') {
            let parent = &remote_file[..slash];
            if !parent.is_empty() {
                mkdir_p(&sess, parent).await?;
            }
        }
        let local_size = std::fs::metadata(local_file)
            .map(|m| m.len())
            .unwrap_or(0);
        let mut f = File::open(local_file)
            .await
            .with_context(|| format!("open local {} failed", local_file.display()))?;
        let mut remote = sess
            .create(&remote_file)
            .await
            .with_context(|| format!("create remote {} failed", remote_file))?;
        let label = format!("{} ({}/{})", remote_file, i + 1, total_files);
        let mut transferred = 0u64;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = f.read(&mut buf).await.context("read local failed")?;
            if n == 0 {
                break;
            }
            remote
                .write_all(&buf[..n])
                .await
                .context("write remote failed")?;
            transferred += n as u64;
            let _ = app.emit(
                &event,
                UploadProgress {
                    local: local_file.display().to_string(),
                    remote: label.clone(),
                    transferred,
                    total: local_size,
                    done: false,
                },
            );
        }
        remote.shutdown().await.ok();
    }

    let _ = app.emit(
        &event,
        UploadProgress {
            local: local.display().to_string(),
            remote: remote_root.clone(),
            transferred: total_files as u64,
            total: total_files as u64,
            done: true,
        },
    );
    Ok(remote_root)
}

pub async fn upload(
    app: AppHandle,
    handle: Arc<Handle<SshClient>>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<String> {
    let local = expand_home(&local_path);
    if !local.exists() {
        return Err(anyhow!("local file not found: {}", local.display()));
    }
    let local_name = local
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("cannot extract local filename"))?
        .to_string();
    let local_size = local
        .metadata()
        .map(|m| m.len())
        .context("stat local file failed")?;

    let sess = sftp(&handle).await?;
    let remote_resolved = resolve_remote(&sess, &remote_path, &local_name).await?;

    info!(
        "sftp upload: {} -> {} ({} bytes)",
        local.display(),
        remote_resolved,
        local_size
    );

    let mut file = File::open(&local)
        .await
        .with_context(|| format!("open local {} failed", local.display()))?;
    let mut remote = sess
        .create(&remote_resolved)
        .await
        .with_context(|| format!("create remote {} failed", remote_resolved))?;

    let event = format!("sftp:progress:{}", session_id);
    let mut transferred = 0u64;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).await.context("read local failed")?;
        if n == 0 {
            break;
        }
        remote
            .write_all(&buf[..n])
            .await
            .context("write remote failed")?;
        transferred += n as u64;
        let _ = app.emit(
            &event,
            UploadProgress {
                local: local.display().to_string(),
                remote: remote_resolved.clone(),
                transferred,
                total: local_size,
                done: false,
            },
        );
    }
    remote.shutdown().await.ok();
    let _ = app.emit(
        &event,
        UploadProgress {
            local: local.display().to_string(),
            remote: remote_resolved.clone(),
            transferred,
            total: local_size,
            done: true,
        },
    );
    Ok(remote_resolved)
}

/// 单引号包裹路径，转义内部的单引号（防止文件名里的空格、`$`、`'`、中文等被 shell 误吃）。
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// 当目标目录写不进去（比如 `/opt/`）时的"sudo 中转"上传：
/// 1) 先用 SFTP 把文件传到 `/tmp/.stelo-upload-<uuid>`（这条用户一定能写）
/// 2) 在 SSH exec 通道里 `sudo mv` 把它挪到真正的目标路径
/// 3) 失败时尽量清理 staging 文件
///
/// 进度事件复用 `sftp:progress:{session_id}`。
pub async fn upload_with_sudo(
    app: AppHandle,
    handle: Arc<Handle<SshClient>>,
    session_id: String,
    local_path: String,
    remote_path: String,
    password: String,
) -> Result<String> {
    let local = expand_home(&local_path);
    if !local.exists() {
        return Err(anyhow!("local file not found: {}", local.display()));
    }
    let local_name = local
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("cannot extract local filename"))?
        .to_string();

    // 推断最终目标路径：以 / 结尾 → 拼文件名；否则当完整路径用。
    // 不去 sftp metadata 探测——目标目录可能用户没读权限（陷入同样的 Permission denied）。
    let final_target = if remote_path.ends_with('/') {
        let base = remote_path.trim_end_matches('/');
        if base.is_empty() {
            format!("/{}", local_name)
        } else {
            format!("{}/{}", base, local_name)
        }
    } else {
        remote_path.clone()
    };

    // 1) SFTP 上传到 /tmp/.stelo-upload-<uuid>-<filename>（保留扩展名便于失败时排查）
    let staging = format!(
        "/tmp/.stelo-upload-{}-{}",
        uuid::Uuid::new_v4(),
        local_name
    );
    let staged = upload(
        app.clone(),
        handle.clone(),
        session_id.clone(),
        local.display().to_string(),
        staging.clone(),
    )
    .await
    .context("upload staging to /tmp failed")?;
    let local_size = local.metadata().map(|m| m.len()).unwrap_or(0);

    // 2) sudo mv 到真正的目标
    let cmd = format!(
        "mv -f {} {}",
        shell_quote(&staged),
        shell_quote(&final_target)
    );
    let result = crate::ssh::exec_sudo(handle.clone(), password, cmd).await;

    match result {
        Ok(r) if r.exit_code == 0 => {
            info!("sftp upload via sudo: {} -> {}", staged, final_target);
            // 补发一条 done 事件，remote 填**真正的目标路径**——CwdPanel 据此判断
            // "父目录==当前 cwd" 决定是否自动刷新（staging 的 /tmp 路径父目录不匹配会被忽略）
            let event = format!("sftp:progress:{}", session_id);
            let _ = app.emit(
                &event,
                UploadProgress {
                    local: local.display().to_string(),
                    remote: final_target.clone(),
                    transferred: local_size,
                    total: local_size,
                    done: true,
                },
            );
            Ok(final_target)
        }
        Ok(r) => {
            // 清理 staging（用户自己创的，普通 SFTP 就能删）
            cleanup_staging(&handle, &staged).await;
            let msg = if !r.stderr.trim().is_empty() {
                r.stderr.trim().to_string()
            } else if !r.stdout.trim().is_empty() {
                r.stdout.trim().to_string()
            } else {
                format!("exit={}", r.exit_code)
            };
            // sudo 自身的密码错提示统一翻译，前端可识别
            if msg.contains("incorrect password") || msg.contains("Sorry, try again") {
                Err(anyhow!("sudo password incorrect"))
            } else {
                Err(anyhow!("sudo mv failed: {}", msg))
            }
        }
        Err(e) => {
            cleanup_staging(&handle, &staged).await;
            Err(e.context("sudo exec failed"))
        }
    }
}

async fn cleanup_staging(handle: &Arc<Handle<SshClient>>, path: &str) {
    if let Ok(sess) = sftp(handle).await {
        let _ = sess.remove_file(path).await;
    }
}

pub async fn list(handle: Arc<Handle<SshClient>>, path: String) -> Result<Vec<Entry>> {
    let sess = sftp(&handle).await?;
    let entries = sess
        .read_dir(&path)
        .await
        .with_context(|| format!("read_dir {} failed", path))?;

    let mut list = Vec::new();
    for e in entries {
        let name = e.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let meta = e.metadata();
        let ft = meta.file_type();
        list.push(Entry {
            name,
            size: meta.size.unwrap_or(0),
            is_dir: matches!(ft, FileType::Dir),
            is_link: matches!(ft, FileType::Symlink),
            mtime: meta.mtime.unwrap_or(0) as u64,
            mode: meta.permissions.unwrap_or(0),
        });
    }
    list.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(list)
}

const MAX_EDIT_SIZE: u64 = 5 * 1024 * 1024;

pub async fn read_text(handle: Arc<Handle<SshClient>>, path: String) -> Result<String> {
    let sess = sftp(&handle).await?;
    let meta = sess
        .metadata(&path)
        .await
        .with_context(|| format!("stat {} failed", path))?;
    if meta.is_dir() {
        return Err(anyhow!("target is a directory: {}", path));
    }
    let size = meta.size.unwrap_or(0);
    if size > MAX_EDIT_SIZE {
        return Err(anyhow!(
            "文件过大（{} bytes），超过 {} MB 上限",
            size,
            MAX_EDIT_SIZE / 1024 / 1024
        ));
    }
    let mut f = sess
        .open(&path)
        .await
        .with_context(|| format!("open {} failed", path))?;
    let mut buf = Vec::with_capacity(size as usize);
    f.read_to_end(&mut buf)
        .await
        .with_context(|| format!("read {} failed", path))?;
    String::from_utf8(buf).map_err(|_| anyhow!("文件不是合法 UTF-8，无法以文本方式编辑"))
}

const MAX_BINARY_READ: u64 = 10 * 1024 * 1024;

pub async fn read_bytes_b64(
    handle: Arc<Handle<SshClient>>,
    path: String,
) -> Result<String> {
    let sess = sftp(&handle).await?;
    let meta = sess
        .metadata(&path)
        .await
        .with_context(|| format!("stat {} failed", path))?;
    if meta.is_dir() {
        return Err(anyhow!("target is a directory: {}", path));
    }
    let size = meta.size.unwrap_or(0);
    if size > MAX_BINARY_READ {
        return Err(anyhow!(
            "文件过大（{} bytes），超过 {} MB 上限",
            size,
            MAX_BINARY_READ / 1024 / 1024
        ));
    }
    let mut f = sess
        .open(&path)
        .await
        .with_context(|| format!("open {} failed", path))?;
    let mut buf = Vec::with_capacity(size as usize);
    f.read_to_end(&mut buf)
        .await
        .with_context(|| format!("read {} failed", path))?;
    Ok(B64.encode(&buf))
}

pub async fn delete(handle: Arc<Handle<SshClient>>, path: String) -> Result<()> {
    let sess = sftp(&handle).await?;
    let meta = sess
        .metadata(&path)
        .await
        .with_context(|| format!("stat {} failed", path))?;
    if meta.is_dir() {
        sess.remove_dir(&path)
            .await
            .with_context(|| format!("remove_dir {} failed（非空目录需清空后再删）", path))?;
    } else {
        sess.remove_file(&path)
            .await
            .with_context(|| format!("remove_file {} failed", path))?;
    }
    Ok(())
}

pub async fn write_text(
    handle: Arc<Handle<SshClient>>,
    path: String,
    content: String,
) -> Result<()> {
    write_bytes(handle, path, content.into_bytes()).await
}

pub async fn write_bytes(
    handle: Arc<Handle<SshClient>>,
    path: String,
    bytes: Vec<u8>,
) -> Result<()> {
    let sess = sftp(&handle).await?;
    let mut f = sess
        .create(&path)
        .await
        .with_context(|| format!("create {} failed", path))?;
    f.write_all(&bytes)
        .await
        .with_context(|| format!("write {} failed", path))?;
    f.shutdown().await.ok();
    Ok(())
}

pub async fn write_bytes_b64(
    handle: Arc<Handle<SshClient>>,
    path: String,
    content_b64: String,
) -> Result<()> {
    let bytes = B64
        .decode(content_b64.as_bytes())
        .with_context(|| "invalid base64")?;
    write_bytes(handle, path, bytes).await
}

pub async fn download(
    app: AppHandle,
    handle: Arc<Handle<SshClient>>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<String> {
    let sess = sftp(&handle).await?;
    let meta = sess
        .metadata(&remote_path)
        .await
        .with_context(|| format!("stat remote {} failed", remote_path))?;
    if meta.is_dir() {
        return Err(anyhow!("remote is a directory; directory download not yet supported"));
    }
    let total = meta.size.unwrap_or(0);

    let local = PathBuf::from(&local_path);
    if let Some(parent) = local.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }

    info!(
        "sftp download: {} -> {} ({} bytes)",
        remote_path, local_path, total
    );

    let mut remote = sess
        .open(&remote_path)
        .await
        .with_context(|| format!("open remote {} failed", remote_path))?;
    let mut file = File::create(&local)
        .await
        .with_context(|| format!("create local {} failed", local.display()))?;

    let event = format!("sftp:download:{}", session_id);
    let mut transferred = 0u64;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = remote.read(&mut buf).await.context("read remote failed")?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).await.context("write local failed")?;
        transferred += n as u64;
        let _ = app.emit(
            &event,
            DownloadProgress {
                remote: remote_path.clone(),
                local: local.display().to_string(),
                transferred,
                total,
                done: false,
            },
        );
    }
    file.shutdown().await.ok();
    let _ = app.emit(
        &event,
        DownloadProgress {
            remote: remote_path.clone(),
            local: local.display().to_string(),
            transferred,
            total,
            done: true,
        },
    );
    Ok(local.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_home_tilde_slash() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(
            expand_home("~/Downloads/a.txt"),
            home.join("Downloads/a.txt")
        );
    }

    #[test]
    fn expand_home_absolute_unchanged() {
        assert_eq!(expand_home("/tmp/a.txt"), PathBuf::from("/tmp/a.txt"));
    }

    #[test]
    fn expand_home_relative_unchanged() {
        assert_eq!(expand_home("relative/file"), PathBuf::from("relative/file"));
    }
}
