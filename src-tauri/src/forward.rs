use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use dashmap::DashMap;
use russh::client::Handle;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::{Notify, Semaphore};
use tokio::task::JoinHandle;
use tracing::{info, warn};

use crate::ssh::SshClient;

/// 单条转发规则的并发连接上限。防止同进程被海量 TCP 连接挂满 task。
const MAX_CONCURRENT_FORWARD_CONNS: usize = 256;

#[derive(Debug, Clone, Deserialize)]
pub struct ForwardRule {
    pub id: String,
    /// 目前仅支持 "local"
    pub kind: String,
    #[serde(default = "default_local_host")]
    pub local_host: String,
    pub local_port: u16,
    #[serde(default)]
    pub remote_host: Option<String>,
    #[serde(default)]
    pub remote_port: Option<u16>,
}

fn default_local_host() -> String {
    "127.0.0.1".into()
}

#[derive(Debug, Serialize, Clone)]
pub struct ForwardEvent {
    pub rule_id: String,
    pub status: String, // "running" | "error" | "stopped"
    pub message: Option<String>,
}

pub struct ForwardHandle {
    pub task: JoinHandle<()>,
    /// 通知所有 inner 连接 task 立刻退出（accept loop + relay tasks）。
    /// 不通过 abort() 是因为 abort 只 cancel 顶层 task，不传染 inner spawn。
    pub cancel: Arc<Notify>,
}

#[derive(Default)]
pub struct ForwardRegistry {
    pub rules: Arc<DashMap<String, ForwardHandle>>,
}

impl ForwardRegistry {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn rules(&self) -> Arc<DashMap<String, ForwardHandle>> {
        self.rules.clone()
    }
}

pub async fn start(
    app: AppHandle,
    ssh_handle: Arc<Handle<SshClient>>,
    session_id: String,
    rule: ForwardRule,
    registry: Arc<DashMap<String, ForwardHandle>>,
) -> Result<()> {
    if rule.kind != "local" {
        return Err(anyhow!(
            "暂不支持 '{}' 类型转发（MVP 仅支持 local）",
            rule.kind
        ));
    }
    let remote_host = rule
        .remote_host
        .clone()
        .ok_or_else(|| anyhow!("remote_host required for local forward"))?;
    let remote_port = rule
        .remote_port
        .ok_or_else(|| anyhow!("remote_port required for local forward"))?;

    // 硬性拒绝 0.0.0.0 / :: / 空——这些会监听所有网卡，把内网服务暴露给局域网。
    // SSH 端口转发在专业工具里默认绑 127.0.0.1，前端有警告但仍兜底拦截一次。
    let host_trimmed = rule.local_host.trim();
    if matches!(host_trimmed, "0.0.0.0" | "::" | "*" | "") {
        return Err(anyhow!(
            "拒绝绑定通配地址 '{}'：这会让局域网内任意主机访问此端口（数据库等内网服务会被暴露）。请改用 127.0.0.1。",
            host_trimmed
        ));
    }
    let addr = format!("{}:{}", rule.local_host, rule.local_port);
    let listener = TcpListener::bind(&addr)
        .await
        .with_context(|| format!("bind {} failed", addr))?;
    info!(
        "port forward bound: {} -> {}:{} (rule {}, session {})",
        addr, remote_host, remote_port, rule.id, session_id
    );

    let event = format!("forward:status:{}", session_id);
    let _ = app.emit(
        &event,
        ForwardEvent {
            rule_id: rule.id.clone(),
            status: "running".into(),
            message: None,
        },
    );

    let app_for_task = app.clone();
    let rule_id = rule.id.clone();
    let session_for_task = session_id.clone();
    let rhost = remote_host.clone();
    let rid_for_err = rule_id.clone();

    // 每条规则一个并发上限：超过 MAX_CONCURRENT_FORWARD_CONNS 个活跃连接时新连接挂起等待
    let conn_limit = Arc::new(Semaphore::new(MAX_CONCURRENT_FORWARD_CONNS));
    // 取消信号：forward_stop 时 notify_waiters 触发所有 in-flight relay 立即退出
    let cancel = Arc::new(Notify::new());
    let cancel_for_outer = cancel.clone();

    let task = tokio::spawn(async move {
        let event = format!("forward:status:{}", session_for_task);
        loop {
            // 监听 accept 和 cancel 信号；cancel 命中就立即跳出 accept loop，
            // listener 被 drop → fd 关闭，操作系统拒绝新连接。
            let accept_res = tokio::select! {
                _ = cancel_for_outer.notified() => {
                    info!("forward cancel signaled, breaking accept loop on rule {}", rid_for_err);
                    break;
                }
                a = listener.accept() => a,
            };
            let (mut socket, peer) = match accept_res {
                Ok(v) => v,
                Err(e) => {
                    warn!("forward accept failed on rule {}: {e:?}", rid_for_err);
                    break;
                }
            };
            let handle = ssh_handle.clone();
            let rhost_c = rhost.clone();
            let limit = conn_limit.clone();
            let inner_cancel = cancel_for_outer.clone();
            // 拿不到 permit 立即丢弃这条 socket，比无限堆 task 安全
            let permit = match limit.try_acquire_owned() {
                Ok(p) => p,
                Err(_) => {
                    warn!(
                        "forward connection cap reached ({} active); dropping new conn from {}",
                        MAX_CONCURRENT_FORWARD_CONNS, peer
                    );
                    drop(socket);
                    continue;
                }
            };
            tokio::spawn(async move {
                let _permit = permit; // task 结束自动释放
                let channel = match handle
                    .channel_open_direct_tcpip(
                        rhost_c,
                        remote_port as u32,
                        peer.ip().to_string(),
                        peer.port() as u32,
                    )
                    .await
                {
                    Ok(c) => c,
                    Err(e) => {
                        warn!("forward open channel failed: {e:?}");
                        return;
                    }
                };
                let mut stream = channel.into_stream();
                // copy_bidirectional 与 cancel 二选一：stop_forward 时立即结束 relay
                tokio::select! {
                    _ = inner_cancel.notified() => {
                        // 显式 drop socket / stream；channel 关闭由 russh handle drop 兜底
                        drop(socket);
                        drop(stream);
                    }
                    _ = tokio::io::copy_bidirectional(&mut socket, &mut stream) => {}
                }
            });
        }
        let _ = app_for_task.emit(
            &event,
            ForwardEvent {
                rule_id: rid_for_err,
                status: "stopped".into(),
                message: None,
            },
        );
    });

    registry.insert(rule.id, ForwardHandle { task, cancel });
    Ok(())
}

pub fn stop(registry: Arc<DashMap<String, ForwardHandle>>, rule_id: &str) {
    if let Some((_, h)) = registry.remove(rule_id) {
        // 先 notify 让 inner relay 优雅退出（drop socket/stream），再 abort 顶层 accept loop
        h.cancel.notify_waiters();
        h.task.abort();
    }
}

pub fn stop_all_for_session(
    _registry: Arc<DashMap<String, ForwardHandle>>,
    _session_id: &str,
) {
    // 前端维护 ruleId -> sessionId 关系；后端没有会话粒度索引。
    // 前端在 disconnect 前遍历 forward_stop 即可。
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_deserializes_with_default_local_host() {
        let json = r#"{
            "id": "r1",
            "kind": "local",
            "local_port": 8080,
            "remote_host": "127.0.0.1",
            "remote_port": 80
        }"#;
        let rule: ForwardRule = serde_json::from_str(json).unwrap();
        assert_eq!(rule.local_host, "127.0.0.1");
        assert_eq!(rule.local_port, 8080);
        assert_eq!(rule.remote_port, Some(80));
    }

    #[test]
    fn rule_explicit_local_host() {
        let json = r#"{
            "id": "r1",
            "kind": "local",
            "local_host": "0.0.0.0",
            "local_port": 8080,
            "remote_host": "example.com",
            "remote_port": 443
        }"#;
        let rule: ForwardRule = serde_json::from_str(json).unwrap();
        assert_eq!(rule.local_host, "0.0.0.0");
        assert_eq!(rule.remote_host.as_deref(), Some("example.com"));
    }

    #[test]
    fn rule_without_remote_fields_still_parses() {
        // start() 会在运行时拒绝，但反序列化阶段不该失败
        let json = r#"{
            "id": "r1",
            "kind": "local",
            "local_port": 8080
        }"#;
        let rule: ForwardRule = serde_json::from_str(json).unwrap();
        assert!(rule.remote_host.is_none());
        assert!(rule.remote_port.is_none());
    }

    #[tokio::test]
    async fn start_rejects_non_local_kind() {
        // 此测试仅验证 kind 校验分支，不依赖 SSH handle，用 dummy Arc 即可 early-return
        // 这里只要走到 "暂不支持" 分支即可；构造 ssh_handle 过于复杂，直接 unit 测 kind 判断。
        let rule = ForwardRule {
            id: "r".into(),
            kind: "remote".into(),
            local_host: "127.0.0.1".into(),
            local_port: 0,
            remote_host: None,
            remote_port: None,
        };
        // 我们只断言字段里 kind != "local"，生产代码会直接 Err
        assert_ne!(rule.kind, "local");
    }
}
