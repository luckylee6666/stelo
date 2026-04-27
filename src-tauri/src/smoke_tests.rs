//! 真实服务器 smoke test。需 `cargo test -- --ignored` 才跑。
//! 环境变量：
//!   STELO_SMOKE_HOST        (默认 82.156.196.149)
//!   STELO_SMOKE_USER        (默认 root)
//!   STELO_SMOKE_KEY         (默认 ~/.ssh/id_ed25519)
//!   STELO_SMOKE_PASSPHRASE  (若私钥带密码)
//!   STELO_SMOKE_PASSWORD    (优先于 key，若设了则走 password 认证)
//! 本文件绕过 Stelo 对 AppHandle 的包装，直接用 russh 打链路，
//! 覆盖 SFTP 和 channel_open_direct_tcpip（端口转发底层）。

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, AuthResult, Handle};
use russh::keys::PrivateKeyWithHashAlg;
use tokio::io::AsyncReadExt;

use crate::sftp;
use crate::ssh::SshClient;

fn host() -> String {
    std::env::var("STELO_SMOKE_HOST").unwrap_or_else(|_| "82.156.196.149".into())
}
fn user() -> String {
    std::env::var("STELO_SMOKE_USER").unwrap_or_else(|_| "root".into())
}
fn key_path() -> PathBuf {
    if let Ok(p) = std::env::var("STELO_SMOKE_KEY") {
        return PathBuf::from(p);
    }
    dirs::home_dir().expect("home").join(".ssh/id_ed25519")
}

async fn connect() -> anyhow::Result<Arc<Handle<SshClient>>> {
    let cfg = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(300)),
        ..Default::default()
    });
    let addr = (host(), 22u16);
    let mut handle: Handle<SshClient> = tokio::time::timeout(
        Duration::from_secs(15),
        client::connect(cfg, addr, SshClient::for_smoke_test()),
    )
    .await??;

    if let Ok(pw) = std::env::var("STELO_SMOKE_PASSWORD") {
        let r = handle.authenticate_password(user(), pw).await?;
        anyhow::ensure!(matches!(r, AuthResult::Success), "password auth failed");
        return Ok(Arc::new(handle));
    }

    // 优先 ssh-agent（macOS 下 ~/.ssh/id_ed25519 通常已 agent 载入）
    if std::env::var("SSH_AUTH_SOCK").is_ok() && std::env::var("STELO_SMOKE_PASSPHRASE").is_err() {
        if let Ok(mut agent) = russh::keys::agent::client::AgentClient::connect_env().await {
            if let Ok(identities) = agent.request_identities().await {
                for pubkey in identities {
                    let r = handle
                        .authenticate_publickey_with(user(), pubkey, None, &mut agent)
                        .await?;
                    if matches!(r, AuthResult::Success) {
                        return Ok(Arc::new(handle));
                    }
                }
            }
        }
    }

    // fallback：文件 + passphrase
    let passphrase = std::env::var("STELO_SMOKE_PASSPHRASE").ok();
    let key = russh::keys::load_secret_key(key_path(), passphrase.as_deref())?;
    let r = handle
        .authenticate_publickey(user(), PrivateKeyWithHashAlg::new(Arc::new(key), None))
        .await?;
    anyhow::ensure!(matches!(r, AuthResult::Success), "publickey auth failed");
    Ok(Arc::new(handle))
}

#[tokio::test]
#[ignore]
async fn smoke_sftp_list_root() {
    let h = connect().await.expect("ssh connect");
    let entries = sftp::list(h, "/".into()).await.unwrap();
    assert!(!entries.is_empty(), "/ should have entries");
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    let has_common = names
        .iter()
        .any(|n| matches!(*n, "etc" | "usr" | "root" | "home" | "var"));
    assert!(has_common, "no common dirs in /: {:?}", names);
    // 目录在前、同类按名字排序的约定
    let first_dirs: Vec<_> = entries.iter().take_while(|e| e.is_dir).collect();
    assert!(!first_dirs.is_empty(), "expected dirs at the top");
}

#[tokio::test]
#[ignore]
async fn smoke_sftp_write_read_rename_delete_mkdir() {
    let h = connect().await.expect("ssh connect");
    let base = format!("/tmp/stelo-smoke-{}", uuid::Uuid::new_v4());

    sftp::mkdir(h.clone(), base.clone()).await.expect("mkdir");

    let file = format!("{}/hello.txt", base);
    sftp::write_text(h.clone(), file.clone(), "Stelo smoke!".into())
        .await
        .expect("write_text");

    let txt = sftp::read_text(h.clone(), file.clone())
        .await
        .expect("read_text");
    assert_eq!(txt, "Stelo smoke!");

    let renamed = format!("{}/renamed.txt", base);
    sftp::rename(h.clone(), file.clone(), renamed.clone())
        .await
        .expect("rename");

    // list 应看到 renamed.txt 但看不到原来的 hello.txt
    let entries = sftp::list(h.clone(), base.clone())
        .await
        .expect("list base");
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&"renamed.txt"), "missing renamed.txt");
    assert!(!names.contains(&"hello.txt"), "old name still exists");

    sftp::delete(h.clone(), renamed.clone())
        .await
        .expect("delete file");
    sftp::delete(h.clone(), base.clone())
        .await
        .expect("delete dir");
}

#[tokio::test]
#[ignore]
async fn smoke_sftp_read_bytes_b64_roundtrip() {
    let h = connect().await.expect("ssh connect");
    let file = format!("/tmp/stelo-smoke-bin-{}.bin", uuid::Uuid::new_v4());
    // 写一段已知 bytes 再以 base64 读回
    sftp::write_text(h.clone(), file.clone(), "\x00\x01ABC\x7f".into())
        .await
        .expect("write_text");
    let b64 = sftp::read_bytes_b64(h.clone(), file.clone())
        .await
        .expect("read_bytes_b64");
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    let bytes = B64.decode(b64.as_bytes()).unwrap();
    assert_eq!(bytes, b"\x00\x01ABC\x7f");
    sftp::delete(h, file).await.ok();
}

#[tokio::test]
#[ignore]
async fn smoke_port_forward_direct_tcpip_to_sshd() {
    // 验证 forward 模块底层调用的 channel_open_direct_tcpip：
    // 打开到远端 127.0.0.1:22 的通道，应收到 SSH banner
    let h = connect().await.expect("ssh connect");
    let channel = h
        .channel_open_direct_tcpip("127.0.0.1", 22, "127.0.0.1", 0)
        .await
        .expect("open direct-tcpip");
    let mut stream = channel.into_stream();
    let mut buf = [0u8; 64];
    let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buf))
        .await
        .expect("banner timeout")
        .expect("banner read");
    let banner = std::str::from_utf8(&buf[..n]).unwrap_or("");
    assert!(
        banner.starts_with("SSH-"),
        "expected SSH banner, got: {:?}",
        banner
    );
}

#[tokio::test]
#[ignore]
async fn smoke_ssh_exec_simple_command() {
    // 用 channel + exec 跑 `echo stelo`，不经 PTY/shell
    let h = connect().await.expect("ssh connect");
    let channel = h.channel_open_session().await.expect("open session");
    channel.exec(true, "echo stelo").await.expect("exec");
    let mut stream = channel.into_stream();
    let mut out = Vec::new();
    // 读直到 EOF 或 2 秒
    let _ = tokio::time::timeout(Duration::from_secs(3), async {
        stream.read_to_end(&mut out).await
    })
    .await;
    let s = String::from_utf8_lossy(&out);
    assert!(s.contains("stelo"), "expected 'stelo' in output, got: {:?}", s);
}
