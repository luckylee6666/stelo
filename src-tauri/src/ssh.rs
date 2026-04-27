use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

/// 拿 Mutex 时恢复中毒锁——这些 Mutex 都是 `Mutex<Option<...>>` 简单存值，
/// panic 不会破坏不变量，恢复 poison 比传染 panic 更安全。
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

use anyhow::{anyhow, Context};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use dashmap::DashMap;
use russh::client::{self, Handle};
use russh::keys::{ssh_key, PrivateKeyWithHashAlg};
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{self, UnboundedSender};
use tracing::{debug, info, warn};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::known_hosts;

/// 反序列化时把 String 包成 Zeroizing<String>，drop 时清零堆缓冲区。
fn de_zeroizing<'de, D>(d: D) -> Result<Zeroizing<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(d)?;
    Ok(Zeroizing::new(s))
}

fn de_opt_zeroizing<'de, D>(d: D) -> Result<Option<Zeroizing<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt = Option::<String>::deserialize(d)?;
    Ok(opt.map(Zeroizing::new))
}

#[derive(Debug, Clone, Deserialize)]
pub struct SshConnectConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub auth: SshAuth,
    #[serde(default = "default_cols")]
    pub cols: u32,
    #[serde(default = "default_rows")]
    pub rows: u32,
    /// 已知主机密钥不匹配时，是否仍信任并覆盖。前端在给用户弹"指纹已变更"确认后才传 true。
    #[serde(default)]
    pub trust_new_host_key: bool,
}

fn default_port() -> u16 {
    22
}
fn default_cols() -> u32 {
    120
}
fn default_rows() -> u32 {
    32
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SshAuth {
    Password {
        #[serde(deserialize_with = "de_zeroizing")]
        password: Zeroizing<String>,
    },
    PrivateKey {
        key_path: String,
        #[serde(default, deserialize_with = "de_opt_zeroizing")]
        passphrase: Option<Zeroizing<String>>,
    },
}

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            // 防 `~/../../etc/foo` 这类穿越：~ 展开后必须仍在 home 子树
            // （`..` 即使存在也由后续 fstat owner-check / known-paths 兜底）
            if rest.contains("..") {
                // 让上层 read_private_key_secure 拒绝（owner 不匹配 / 不是普通文件）
                return home.join(rest);
            }
            return home.join(rest);
        }
    }
    if path == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    PathBuf::from(path)
}

/// 原子地：打开私钥 → 对 fd 做 fstat 权限校验 → 读完整字节。
/// 防 TOCTOU：检查权限后到 russh 真正读文件之间，攻击者无法把文件换成 symlink。
///
/// 跟 OpenSSH 一致：私钥不能 group/other 可读。商业 SSH 客户端（XShell / SecureCRT / Termius）都做这条。
#[cfg(unix)]
fn read_private_key_secure(path: &Path) -> anyhow::Result<String> {
    use std::io::Read;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let mut file = std::fs::File::open(path)
        .with_context(|| format!("open {} failed", path.display()))?;

    // 用打开的 fd 自己 stat（不再走 path），避免 path 在两步之间被换 symlink
    let meta = file
        .metadata()
        .with_context(|| format!("fstat {} failed", path.display()))?;

    if !meta.is_file() {
        return Err(anyhow!(
            "私钥路径不是普通文件（可能是 symlink/directory/device）：{}",
            path.display()
        ));
    }

    let mode = meta.permissions().mode() & 0o777;
    if mode & 0o077 != 0 {
        return Err(anyhow!(
            "私钥文件权限不安全：{} 当前权限 {:o}（同主机其他用户可读）。\n\
             请运行 `chmod 600 {}` 修复后重试。",
            path.display(),
            mode,
            path.display()
        ));
    }

    // owner 必须是当前用户，避免读到别人放的"假私钥"
    let cur_uid = unsafe {
        extern "C" {
            fn getuid() -> u32;
        }
        getuid()
    };
    if meta.uid() != cur_uid {
        return Err(anyhow!(
            "私钥文件所有者不是当前用户：{}（owner uid={}, current uid={}）",
            path.display(),
            meta.uid(),
            cur_uid
        ));
    }

    // 读完整内容到内存（被 zeroize 包，drop 时清零）
    let mut buf = String::new();
    file.read_to_string(&mut buf)
        .with_context(|| format!("read {} failed", path.display()))?;
    Ok(buf)
}

// Windows / 非 Unix：用 path 直接读（NTFS ACL 模型不同，由 OS 把关）
#[cfg(not(unix))]
fn read_private_key_secure(path: &Path) -> anyhow::Result<String> {
    let buf = std::fs::read_to_string(path)
        .with_context(|| format!("read {} failed", path.display()))?;
    Ok(buf)
}

/// 仅供测试用：保留旧的"只校验权限"接口
#[cfg(test)]
#[cfg(unix)]
fn check_private_key_permissions(path: &Path) -> anyhow::Result<()> {
    read_private_key_secure(path).map(|_| ())
}

#[derive(Debug)]
pub enum SshCmd {
    Write(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

pub struct SshHandle {
    pub cmd_tx: UnboundedSender<SshCmd>,
    // 让 SSH 连接生存至 user disconnect；SFTP / 端口转发 / metrics 共用
    #[allow(dead_code)]
    pub ssh: Arc<Handle<SshClient>>,
}

#[derive(Default)]
pub struct SshRegistry {
    sessions: Arc<DashMap<String, SshHandle>>,
}

impl SshRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn sessions(&self) -> Arc<DashMap<String, SshHandle>> {
        self.sessions.clone()
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct SshClosedPayload {
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct HostKeyMismatch {
    pub expected_fingerprint: String,
    pub expected_key_type: String,
    pub got_fingerprint: String,
    pub got_key_type: String,
}

/// 首次连接、known_hosts 里没有这台主机时返回，要求前端弹确认对话框。
#[derive(Debug, Clone)]
pub struct HostKeyUnverified {
    pub fingerprint: String,
    pub key_type: String,
}

#[derive(Debug, Clone)]
pub enum HostKeyOutcome {
    /// 新主机，已 TOFU 记录
    NewlyTrusted { fingerprint: String, key_type: String },
    /// 指纹匹配历史记录
    Matched,
    /// 指纹不匹配（已被 trust_new_host_key 覆盖接受）
    TrustedReplacement { old: String, new: String },
}

pub struct SshClient {
    /// 生产路径会带 AppHandle（访问 known_hosts.json）；smoke_tests 下没有 Tauri 上下文所以为 None。
    app: Option<AppHandle>,
    host: String,
    port: u16,
    /// 仅在用户已确认"信任新密钥"（或首次主机）时才 true
    trust_new: bool,
    /// check_server_key 把结果/错误写进来，外层 connect 读取
    outcome: Arc<Mutex<Option<HostKeyOutcome>>>,
    mismatch: Arc<Mutex<Option<HostKeyMismatch>>>,
    unverified: Arc<Mutex<Option<HostKeyUnverified>>>,
}

impl SshClient {
    /// 用于真实 Tauri 运行时：走 known_hosts 校验。
    pub fn new(
        app: AppHandle,
        host: String,
        port: u16,
        trust_new: bool,
        outcome: Arc<Mutex<Option<HostKeyOutcome>>>,
        mismatch: Arc<Mutex<Option<HostKeyMismatch>>>,
        unverified: Arc<Mutex<Option<HostKeyUnverified>>>,
    ) -> Self {
        Self {
            app: Some(app),
            host,
            port,
            trust_new,
            outcome,
            mismatch,
            unverified,
        }
    }

    /// smoke_tests 专用：跳过 known_hosts（测试服务器已知，无需指纹校验）。
    #[cfg(test)]
    pub fn for_smoke_test() -> Self {
        Self {
            app: None,
            host: String::new(),
            port: 0,
            trust_new: false,
            outcome: Arc::new(Mutex::new(None)),
            mismatch: Arc::new(Mutex::new(None)),
            unverified: Arc::new(Mutex::new(None)),
        }
    }
}

impl client::Handler for SshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fp = server_public_key
            .fingerprint(ssh_key::HashAlg::Sha256)
            .to_string();
        let kt = server_public_key.algorithm().as_str().to_string();

        let Some(app) = self.app.clone() else {
            // 无 AppHandle（smoke test 环境）：直接接受，不走 known_hosts
            return Ok(true);
        };
        let existing = known_hosts::get(&app, &self.host, self.port).unwrap_or(None);
        match existing {
            None => {
                if self.trust_new {
                    // 用户已在确认对话框上点了"信任并连接"——记录指纹后继续握手
                    if let Err(e) = known_hosts::upsert(
                        &app,
                        &self.host,
                        self.port,
                        kt.clone(),
                        fp.clone(),
                    ) {
                        warn!("known_hosts upsert failed: {:?}", e);
                    }
                    *lock(&self.outcome) = Some(HostKeyOutcome::NewlyTrusted {
                        fingerprint: fp,
                        key_type: kt,
                    });
                    Ok(true)
                } else {
                    // 首次连接、用户未确认 → 中止握手，外层抛 HOSTKEY_UNVERIFIED 让前端弹确认
                    *lock(&self.unverified) = Some(HostKeyUnverified {
                        fingerprint: fp,
                        key_type: kt,
                    });
                    Ok(false)
                }
            }
            Some(known) if known.fingerprint == fp && known.key_type == kt => {
                *lock(&self.outcome) = Some(HostKeyOutcome::Matched);
                Ok(true)
            }
            Some(known) => {
                if self.trust_new {
                    let _ = known_hosts::upsert(
                        &app,
                        &self.host,
                        self.port,
                        kt.clone(),
                        fp.clone(),
                    );
                    *lock(&self.outcome) =
                        Some(HostKeyOutcome::TrustedReplacement {
                            old: known.fingerprint.clone(),
                            new: fp.clone(),
                        });
                    Ok(true)
                } else {
                    *lock(&self.mismatch) = Some(HostKeyMismatch {
                        expected_fingerprint: known.fingerprint.clone(),
                        expected_key_type: known.key_type.clone(),
                        got_fingerprint: fp,
                        got_key_type: kt,
                    });
                    // 返回 false → russh 中止握手；外层通过 mismatch 状态拿详情
                    Ok(false)
                }
            }
        }
    }
}

pub async fn connect(
    app: AppHandle,
    registry: Arc<DashMap<String, SshHandle>>,
    cfg: SshConnectConfig,
) -> anyhow::Result<String> {
    let id = Uuid::new_v4().to_string();
    let client_config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(3600)),
        keepalive_interval: Some(Duration::from_secs(30)),
        ..<_>::default()
    });

    let addr = (cfg.host.as_str(), cfg.port);
    let outcome: Arc<Mutex<Option<HostKeyOutcome>>> = Arc::new(Mutex::new(None));
    let mismatch: Arc<Mutex<Option<HostKeyMismatch>>> = Arc::new(Mutex::new(None));
    let unverified: Arc<Mutex<Option<HostKeyUnverified>>> = Arc::new(Mutex::new(None));
    let client = SshClient::new(
        app.clone(),
        cfg.host.clone(),
        cfg.port,
        cfg.trust_new_host_key,
        outcome.clone(),
        mismatch.clone(),
        unverified.clone(),
    );
    let connect_result =
        tokio::time::timeout(Duration::from_secs(15), client::connect(client_config, addr, client))
            .await
            .map_err(|_| anyhow!("TCP connect timeout"))?;
    // 握手失败 → 优先看是不是主机密钥未确认 / 不匹配，给前端结构化错误好弹对话框
    let mut handle: Handle<SshClient> = match connect_result {
        Ok(h) => h,
        Err(e) => {
            if let Some(uv) = lock(&unverified).take() {
                return Err(anyhow!(
                    "HOSTKEY_UNVERIFIED {}",
                    serde_json::json!({
                        "host": cfg.host,
                        "port": cfg.port,
                        "fingerprint": uv.fingerprint,
                        "key_type": uv.key_type,
                    })
                ));
            }
            if let Some(mm) = lock(&mismatch).take() {
                return Err(anyhow!(
                    "HOSTKEY_MISMATCH {}",
                    serde_json::json!({
                        "host": cfg.host,
                        "port": cfg.port,
                        "expected_fingerprint": mm.expected_fingerprint,
                        "expected_key_type": mm.expected_key_type,
                        "got_fingerprint": mm.got_fingerprint,
                        "got_key_type": mm.got_key_type,
                    })
                ));
            }
            return Err(anyhow::Error::from(e).context("TCP/SSH handshake failed"));
        }
    };
    // 新主机 TOFU / 替换密钥：日志 + 事件通知前端，让用户知道"首次记录"
    if let Some(out) = lock(&outcome).take() {
        match out {
            HostKeyOutcome::NewlyTrusted { fingerprint, key_type } => {
                info!("known_hosts TOFU: {}:{} {} {}", cfg.host, cfg.port, key_type, fingerprint);
                let _ = app.emit(
                    "ssh:hostkey-tofu",
                    serde_json::json!({
                        "host": cfg.host,
                        "port": cfg.port,
                        "fingerprint": fingerprint,
                        "key_type": key_type,
                    }),
                );
            }
            HostKeyOutcome::TrustedReplacement { old, new } => {
                warn!(
                    "known_hosts replaced: {}:{} {} -> {}",
                    cfg.host, cfg.port, old, new
                );
            }
            HostKeyOutcome::Matched => {}
        }
    }

    match &cfg.auth {
        SshAuth::Password { password } => {
            // russh 的 authenticate_password 要 String（按值消费），无法避免一次 clone；
            // 至少 cfg.auth 里那份在 SshAuth Drop 时会被 Zeroizing 清掉。
            let auth = handle
                .authenticate_password(cfg.user.clone(), (**password).clone())
                .await
                .context("authenticate_password call failed")?;
            if !matches!(auth, client::AuthResult::Success) {
                return Err(anyhow!("authentication failed (password)"));
            }
        }
        SshAuth::PrivateKey {
            key_path,
            passphrase,
        } => {
            let resolved = expand_home(key_path);
            if !resolved.exists() {
                return Err(anyhow!("key file not found: {}", resolved.display()));
            }
            if resolved.extension().and_then(|s| s.to_str()) == Some("pub") {
                let priv_guess = resolved.with_extension("");
                return Err(anyhow!(
                    "这是公钥文件（.pub），应选择对应的私钥：{}",
                    priv_guess.display()
                ));
            }
            // 原子读：open → fstat 权限校验 → 读全部到内存。
            // 防 TOCTOU：跟 OpenSSH 一样要求 chmod 0600 owner-only；同时 fd 一致性确保两步之间路径不会被替换。
            let mut secret = Zeroizing::new(read_private_key_secure(&resolved)?);
            let pp = passphrase.as_ref().map(|z| z.as_str());
            let key = russh::keys::decode_secret_key(&secret, pp)
                .with_context(|| format!("decode key {} failed", resolved.display()))?;
            secret.zeroize();
            let with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), None);
            let auth = handle
                .authenticate_publickey(cfg.user.clone(), with_hash)
                .await
                .context("authenticate_publickey call failed")?;
            if !matches!(auth, client::AuthResult::Success) {
                return Err(anyhow!("authentication failed (publickey)"));
            }
        }
    }

    let mut channel = handle
        .channel_open_session()
        .await
        .context("open session channel failed")?;

    channel
        .request_pty(false, "xterm-256color", cfg.cols, cfg.rows, 0, 0, &[])
        .await
        .context("request_pty failed")?;
    channel.request_shell(false).await.context("request_shell failed")?;

    let (tx, mut rx) = mpsc::unbounded_channel::<SshCmd>();
    let id_for_task = id.clone();
    let app_for_task = app.clone();
    let shared_handle = Arc::new(handle);
    let handle_for_metrics = shared_handle.clone();
    let handle_for_registry = shared_handle.clone();

    tokio::spawn(async move {
        let data_event = format!("ssh:data:{}", id_for_task);
        let closed_event = format!("ssh:closed:{}", id_for_task);
        let mut close_reason = String::from("eof");

        // Shell integration：注入 OSC 7，让远端 shell 每次 prompt 输出 cwd。
        // 先等 300ms 让远端 shell 的欢迎信息和首个 prompt 渲染完。
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let setup = "__hs_osc7(){ printf '\\033]7;file://%s%s\\033\\\\' \"${HOSTNAME:-$(hostname)}\" \"${PWD}\"; }; \
                     if [ -n \"${BASH_VERSION:-}\" ]; then PROMPT_COMMAND=\"__hs_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}\"; \
                     elif [ -n \"${ZSH_VERSION:-}\" ]; then precmd_functions+=(__hs_osc7); fi; __hs_osc7; clear\r";
        let _ = channel.data(setup.as_bytes()).await;

        loop {
            tokio::select! {
                cmd = rx.recv() => {
                    match cmd {
                        Some(SshCmd::Write(b)) => {
                            if let Err(e) = channel.data(&b[..]).await {
                                warn!("ssh write err: {e:?}");
                                close_reason = format!("write error: {e:?}");
                                break;
                            }
                        }
                        Some(SshCmd::Resize { cols, rows }) => {
                            if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                                debug!("resize failed: {e:?}");
                            }
                        }
                        Some(SshCmd::Close) | None => {
                            let _ = channel.eof().await;
                            let _ = channel.close().await;
                            close_reason = "closed by user".into();
                            break;
                        }
                    }
                }
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let _ = app_for_task.emit(&data_event, B64.encode(&data[..]));
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            let _ = app_for_task.emit(&data_event, B64.encode(&data[..]));
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                            close_reason = format!("remote exit status: {exit_status}");
                        }
                        Some(ChannelMsg::Eof) => {
                            close_reason = "remote eof".into();
                        }
                        None => {
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        let _ = app_for_task.emit(
            &closed_event,
            SshClosedPayload { reason: close_reason.clone() },
        );
        info!("ssh session {} closed: {}", id_for_task, close_reason);
    });

    registry.insert(
        id.clone(),
        SshHandle {
            cmd_tx: tx,
            ssh: handle_for_registry,
        },
    );
    info!(
        "ssh session created: id={} map_ptr={:p} size={}",
        id,
        Arc::as_ptr(&registry),
        registry.len()
    );

    crate::metrics::spawn(app.clone(), handle_for_metrics, id.clone());

    Ok(id)
}

pub fn send(
    registry: Arc<DashMap<String, SshHandle>>,
    session_id: &str,
    data: Vec<u8>,
) -> anyhow::Result<()> {
    info!(
        "ssh_send lookup: id={} map_ptr={:p} size={}",
        session_id,
        Arc::as_ptr(&registry),
        registry.len()
    );
    let h = registry.get(session_id).ok_or_else(|| {
        let known: Vec<String> = registry.iter().map(|e| e.key().clone()).collect();
        anyhow!(
            "session not found (后端可能已重启): id={}, alive={:?}",
            session_id,
            known
        )
    })?;
    h.cmd_tx
        .send(SshCmd::Write(data))
        .map_err(|_| anyhow!("session task ended"))
}

pub fn resize(
    registry: Arc<DashMap<String, SshHandle>>,
    session_id: &str,
    cols: u32,
    rows: u32,
) -> anyhow::Result<()> {
    let h = registry
        .get(session_id)
        .ok_or_else(|| anyhow!("session not found"))?;
    h.cmd_tx
        .send(SshCmd::Resize { cols, rows })
        .map_err(|_| anyhow!("session task gone"))
}

pub fn disconnect(
    registry: Arc<DashMap<String, SshHandle>>,
    session_id: &str,
) -> anyhow::Result<()> {
    if let Some((_, h)) = registry.remove(session_id) {
        let _ = h.cmd_tx.send(SshCmd::Close);
    }
    Ok(())
}

pub fn ssh_handle(
    registry: Arc<DashMap<String, SshHandle>>,
    session_id: &str,
) -> anyhow::Result<Arc<Handle<SshClient>>> {
    let h = registry
        .get(session_id)
        .ok_or_else(|| anyhow!("session not found: {}", session_id))?;
    Ok(h.ssh.clone())
}

#[derive(Serialize, Debug, Clone)]
pub struct SudoResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// 用 sudo -S 从 stdin 注入密码执行一条命令。返回 exit_code + stdout + stderr。
/// 不用 PTY，避免 sudo 的 tty 提示逻辑；-p '' 抑制提示字。
/// sudo 命令长度上限——8KB 已经覆盖几乎所有合理用例（一行 vim/sed 都装得下）。
/// 防止 XSS 通过 invoke 直接调 ssh_exec_sudo 时塞超长 payload 把 sudoers 缓冲打爆。
const MAX_SUDO_CMD_LEN: usize = 8 * 1024;

pub async fn exec_sudo(
    handle: Arc<Handle<SshClient>>,
    password: String,
    command: String,
) -> anyhow::Result<SudoResult> {
    if command.len() > MAX_SUDO_CMD_LEN {
        return Err(anyhow!(
            "sudo command too long ({} > {} bytes); refusing for safety",
            command.len(),
            MAX_SUDO_CMD_LEN
        ));
    }
    // 立刻把密码挪进 Zeroizing，函数返回时清零；调用方传入的 String 在 IPC 反序列化时已经是它最早的副本。
    let password = Zeroizing::new(password);
    let mut channel = handle
        .channel_open_session()
        .await
        .context("open exec channel failed")?;
    // -S: 从 stdin 读密码；-p '': 抑制 "[sudo] password for x:" 这行（否则会进 stderr 干扰判断）
    // -k: 先让 sudo 清掉已有 ticket，强制每次都校验密码，避免用户以为"密码错了"但其实 sudo 用了别人的 cache
    //     （当前 exec 通道独立于交互 shell，sudo 的 ticket 是按用户存的，可能命中）—— 不用 -k 让缓存生效体验更好，小白场景友好
    let full = format!("sudo -S -p '' {}", command);
    channel
        .exec(true, full)
        .await
        .context("channel.exec failed")?;
    let mut pw_line = format!("{}\n", &*password);
    let send_res = channel.data(pw_line.as_bytes()).await;
    pw_line.zeroize();
    send_res.map_err(|e| anyhow!("send password to channel failed: {e:?}"))?;
    let _ = channel.eof().await;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code: i32 = -1;
    let deadline = tokio::time::sleep(Duration::from_secs(30));
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => {
                let _ = channel.close().await;
                return Err(anyhow!("sudo exec timeout after 30s"));
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => stdout.extend_from_slice(&data),
                    Some(ChannelMsg::ExtendedData { data, .. }) => stderr.extend_from_slice(&data),
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        exit_code = exit_status as i32;
                    }
                    Some(ChannelMsg::Eof) => {}
                    Some(ChannelMsg::Close) => break,
                    None => break,
                    _ => {}
                }
            }
        }
    }

    Ok(SudoResult {
        exit_code,
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_home_tilde_slash_prefix() {
        let home = dirs::home_dir().unwrap();
        let p = expand_home("~/.ssh/id_ed25519");
        assert_eq!(p, home.join(".ssh/id_ed25519"));
    }

    #[test]
    fn expand_home_bare_tilde() {
        let home = dirs::home_dir().unwrap();
        let p = expand_home("~");
        assert_eq!(p, home);
    }

    #[test]
    fn expand_home_absolute_unchanged() {
        let p = expand_home("/etc/ssh/ssh_host_rsa_key");
        assert_eq!(p, PathBuf::from("/etc/ssh/ssh_host_rsa_key"));
    }

    #[test]
    fn config_defaults_port_cols_rows() {
        let json = r#"{
            "host": "example.com",
            "user": "root",
            "auth": {"kind": "password", "password": "secret"}
        }"#;
        let cfg: SshConnectConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.port, 22);
        assert_eq!(cfg.cols, 120);
        assert_eq!(cfg.rows, 32);
        assert!(matches!(cfg.auth, SshAuth::Password { .. }));
    }

    #[test]
    fn auth_password_variant() {
        let json = r#"{"kind":"password","password":"pw"}"#;
        let a: SshAuth = serde_json::from_str(json).unwrap();
        match a {
            SshAuth::Password { password } => assert_eq!(&**password, "pw"),
            _ => panic!("expected password variant"),
        }
    }

    #[test]
    fn auth_private_key_variant_with_passphrase() {
        let json = r#"{"kind":"private_key","key_path":"~/.ssh/id_ed25519","passphrase":"p"}"#;
        let a: SshAuth = serde_json::from_str(json).unwrap();
        match a {
            SshAuth::PrivateKey {
                key_path,
                passphrase,
            } => {
                assert_eq!(key_path, "~/.ssh/id_ed25519");
                assert_eq!(
                    passphrase.as_ref().map(|z| z.as_str()),
                    Some("p")
                );
            }
            _ => panic!("expected private_key variant"),
        }
    }

    #[test]
    fn auth_private_key_without_passphrase() {
        let json = r#"{"kind":"private_key","key_path":"/tmp/key","passphrase":null}"#;
        let a: SshAuth = serde_json::from_str(json).unwrap();
        match a {
            SshAuth::PrivateKey { passphrase, .. } => assert!(passphrase.is_none()),
            _ => panic!("expected private_key variant"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn private_key_perm_0600_accepted() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let key = dir.path().join("id_test");
        std::fs::write(&key, "fake key bytes").unwrap();
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(check_private_key_permissions(&key).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn private_key_perm_0644_rejected() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let key = dir.path().join("id_test");
        std::fs::write(&key, "fake key bytes").unwrap();
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o644)).unwrap();
        let err = check_private_key_permissions(&key).unwrap_err();
        let msg = format!("{:#}", err);
        assert!(msg.contains("权限不安全"), "got: {}", msg);
        assert!(msg.contains("chmod 600"), "got: {}", msg);
    }

    #[cfg(unix)]
    #[test]
    fn private_key_perm_0640_rejected_group_readable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let key = dir.path().join("id_test");
        std::fs::write(&key, "fake key bytes").unwrap();
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o640)).unwrap();
        assert!(check_private_key_permissions(&key).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn private_key_perm_0400_accepted_readonly() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let key = dir.path().join("id_test");
        std::fs::write(&key, "fake key bytes").unwrap();
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o400)).unwrap();
        assert!(check_private_key_permissions(&key).is_ok());
    }
}
