use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use anyhow::{anyhow, Context, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

/// 凭据按 account 存在 app_data_dir/credentials.json：
///   { "v": 3, "salt": "<hex>", "nonce": "<hex>", "ct": "<base64>" }
/// v3 加密：AES-256-GCM + Argon2id KDF
///   ikm = 机器派生("hostname:uid:bundle_id")
///   pepper = app_data_dir/.master_salt（32B 真随机，chmod 600，App 首次启动生成；丢失则旧密文不可解）
///   key = Argon2id(password = ikm || pepper, salt = per-record-salt, m=64MiB t=3 p=4) -> 32B
/// 文件本身仍 chmod 600。
///
/// 攻击模型抵抗：
/// - 偷 credentials.json：解不开（缺 master_salt）
/// - 偷 master_salt：解不开（缺机器派生 IKM）
/// - 偷整个 app_data_dir 但搬到别的机器：解不开（hostname/uid 变了）
/// - 同主机 root：能拿到全部，无法防御（OS 信任边界外）
fn creds_file(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("resolve app_data_dir failed")?;
    fs::create_dir_all(&dir).ok();
    Ok(dir.join("credentials.json"))
}

fn master_salt_file(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("resolve app_data_dir failed")?;
    fs::create_dir_all(&dir).ok();
    Ok(dir.join(".master_salt"))
}

/// 拿持久化的 32B master_salt；不存在就生成。每个 stelo 安装独一份。
fn load_or_init_master_salt(file: &Path) -> Result<[u8; 32]> {
    if file.exists() {
        let bytes = fs::read(file).with_context(|| format!("read {} failed", file.display()))?;
        if bytes.len() == 32 {
            let mut out = [0u8; 32];
            out.copy_from_slice(&bytes);
            return Ok(out);
        }
        return Err(anyhow!("master_salt at {} corrupted (size != 32)", file.display()));
    }
    let mut out = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut out);
    let tmp = file.with_extension("salt.tmp");
    // 用 OpenOptions 创建文件并对 fd 立刻 chmod，避免 fs::write 后 set_permissions 之间的 TOCTOU 窗口
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
        f.write_all(&out)
            .with_context(|| format!("write {} failed", tmp.display()))?;
    }
    fs::rename(&tmp, file)
        .with_context(|| format!("rename to {} failed", file.display()))?;
    Ok(out)
}

/// 机器+用户派生材料：变这台机器或换用户后旧密文不可解。
fn machine_ikm() -> Vec<u8> {
    let host = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("HOST"))
        .ok()
        .or_else(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "unknown-host".to_string());
    let uid = unsafe { libc_getuid() };
    format!("stelo:v3:{}:{}:com.lucky.stelo", host, uid).into_bytes()
}

#[cfg(unix)]
unsafe fn libc_getuid() -> u32 {
    extern "C" {
        fn getuid() -> u32;
    }
    getuid()
}
#[cfg(not(unix))]
unsafe fn libc_getuid() -> u32 {
    0
}

/// Argon2id 派生 32B 加密密钥。
/// 入口素材 = ikm ‖ master_salt（pepper），salt = 每条记录随机 16B。
/// 参数：m=64MiB / t=3 / p=4 — 商用合理强度，单次 ~150ms（凭据写入路径不是热点）。
fn derive_key(per_record_salt: &[u8], master_salt: &[u8; 32]) -> Result<[u8; 32]> {
    let mut password = machine_ikm();
    password.extend_from_slice(master_salt);

    let params = Params::new(64 * 1024, 3, 4, Some(32))
        .map_err(|e| anyhow!("argon2 params: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut out = [0u8; 32];
    argon
        .hash_password_into(&password, per_record_salt, &mut out)
        .map_err(|e| anyhow!("argon2 derive: {e}"))?;
    password.zeroize();
    Ok(out)
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    /// 文件格式版本：
    /// - v3 = Argon2id（当前）
    /// - v2 = HKDF-SHA256（旧版，自动迁移到 v3）
    /// - 无 / 其它 = 明文（最旧，自动迁移）
    v: u32,
    salt: String,  // hex (per-record salt for KDF)
    nonce: String, // hex (12B GCM nonce)
    ct: String,    // base64 (AES-256-GCM ciphertext)
}

/// 用 master_salt 解 v3 envelope。
fn decrypt_envelope(env: &Envelope, master_salt: &[u8; 32]) -> Result<BTreeMap<String, String>> {
    let salt = hex::decode(&env.salt).context("salt not hex")?;
    let nonce_bytes = hex::decode(&env.nonce).context("nonce not hex")?;
    if nonce_bytes.len() != 12 {
        return Err(anyhow!("nonce must be 12 bytes"));
    }
    let ct = base64_decode(&env.ct)?;

    let mut key = derive_key(&salt, master_salt)?;
    let cipher = Aes256Gcm::new((&key).into());
    let pt = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ct.as_ref())
        .map_err(|_| anyhow!("decrypt failed (machine/user/master_salt changed?)"))?;
    key.zeroize();

    let map: BTreeMap<String, String> = serde_json::from_slice(&pt)
        .context("decrypted payload not valid JSON")?;
    Ok(map)
}

fn read_all_at(file: &Path, master_salt: &[u8; 32]) -> Result<BTreeMap<String, String>> {
    if !file.exists() {
        return Ok(BTreeMap::new());
    }
    let text = fs::read_to_string(file)
        .with_context(|| format!("read {} failed", file.display()))?;
    if text.trim().is_empty() {
        return Ok(BTreeMap::new());
    }

    // 新格式 v3 envelope
    if let Ok(env) = serde_json::from_str::<Envelope>(&text) {
        if env.v == 3 {
            return decrypt_envelope(&env, master_salt);
        }
        // v2（HKDF）已是历史格式：尝试用旧逻辑读出，再以 v3 重写
        if env.v == 2 {
            let map = decrypt_envelope_v2(&env)?;
            write_all_at(file, &map, master_salt)
                .context("migrate v2 (HKDF) -> v3 (Argon2id) failed")?;
            return Ok(map);
        }
    }

    // 最旧：纯明文 BTreeMap
    let map: BTreeMap<String, String> = serde_json::from_str(&text)
        .with_context(|| format!("parse {} failed", file.display()))?;
    write_all_at(file, &map, master_salt)
        .with_context(|| format!("migrate {} to encrypted format failed", file.display()))?;
    Ok(map)
}

/// 兼容 v2（HKDF-SHA256）envelope 的解密：仅在迁移路径上用一次。
fn decrypt_envelope_v2(env: &Envelope) -> Result<BTreeMap<String, String>> {
    use hkdf::Hkdf;
    use sha2::Sha256;

    let salt = hex::decode(&env.salt).context("salt not hex")?;
    let nonce_bytes = hex::decode(&env.nonce).context("nonce not hex")?;
    if nonce_bytes.len() != 12 {
        return Err(anyhow!("nonce must be 12 bytes"));
    }
    let ct = base64_decode(&env.ct)?;

    let host = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("HOST"))
        .ok()
        .or_else(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "unknown-host".to_string());
    let uid = unsafe { libc_getuid() };
    let ikm = format!("stelo:v2:{}:{}:com.lucky.stelo", host, uid).into_bytes();

    let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let mut key = [0u8; 32];
    hk.expand(b"stelo-credentials-v2", &mut key)
        .map_err(|e| anyhow!("v2 hkdf expand: {e}"))?;
    let cipher = Aes256Gcm::new((&key).into());
    let pt = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ct.as_ref())
        .map_err(|_| anyhow!("v2 decrypt failed"))?;
    key.zeroize();
    let map: BTreeMap<String, String> = serde_json::from_slice(&pt)
        .context("v2 decrypted payload not valid JSON")?;
    Ok(map)
}

fn write_all_at(
    file: &Path,
    map: &BTreeMap<String, String>,
    master_salt: &[u8; 32],
) -> Result<()> {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);

    let plaintext = serde_json::to_vec(map)?;
    let mut key = derive_key(&salt, master_salt)?;
    let cipher = Aes256Gcm::new((&key).into());
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_ref())
        .map_err(|e| anyhow!("encrypt failed: {e}"))?;
    key.zeroize();

    let env = Envelope {
        v: 3,
        salt: hex::encode(salt),
        nonce: hex::encode(nonce),
        ct: base64_encode(&ct),
    };
    let text = serde_json::to_string_pretty(&env)?;

    let tmp = file.with_extension("json.tmp");
    // OpenOptions + fd-level chmod，无 TOCTOU 窗口
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

fn base64_encode(b: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(b)
}

fn base64_decode(s: &str) -> Result<Vec<u8>> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(s.as_bytes())
        .context("base64 decode failed")
}

fn save_at(file: &Path, account: &str, secret: &str, master_salt: &[u8; 32]) -> Result<()> {
    let mut map = read_all_at(file, master_salt)?;
    map.insert(account.to_string(), secret.to_string());
    write_all_at(file, &map, master_salt)
}

fn load_at(file: &Path, account: &str, master_salt: &[u8; 32]) -> Result<Option<String>> {
    let map = read_all_at(file, master_salt)?;
    Ok(map.get(account).cloned())
}

fn delete_at(file: &Path, account: &str, master_salt: &[u8; 32]) -> Result<()> {
    let mut map = read_all_at(file, master_salt)?;
    if map.remove(account).is_some() {
        write_all_at(file, &map, master_salt)?;
    }
    Ok(())
}

pub fn save(app: &AppHandle, account: &str, secret: &str) -> Result<()> {
    let salt = load_or_init_master_salt(&master_salt_file(app)?)?;
    save_at(&creds_file(app)?, account, secret, &salt)
}

pub fn load(app: &AppHandle, account: &str) -> Result<Option<String>> {
    let salt = load_or_init_master_salt(&master_salt_file(app)?)?;
    load_at(&creds_file(app)?, account, &salt)
}

pub fn delete(app: &AppHandle, account: &str) -> Result<()> {
    let salt = load_or_init_master_salt(&master_salt_file(app)?)?;
    delete_at(&creds_file(app)?, account, &salt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fixed_salt() -> [u8; 32] {
        // 测试用固定 salt，模拟"已经初始化好的安装"
        let mut s = [0u8; 32];
        for i in 0..32 {
            s[i] = i as u8;
        }
        s
    }

    #[test]
    fn load_on_missing_file_returns_none() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        assert!(load_at(&file, "anything", &fixed_salt()).unwrap().is_none());
    }

    #[test]
    fn save_then_load_returns_secret() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        let s = fixed_salt();
        save_at(&file, "sess1:password", "hunter2", &s).unwrap();
        assert_eq!(
            load_at(&file, "sess1:password", &s).unwrap().as_deref(),
            Some("hunter2")
        );
    }

    #[test]
    fn save_multiple_accounts_preserved() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        let s = fixed_salt();
        save_at(&file, "a:password", "pw1", &s).unwrap();
        save_at(&file, "b:passphrase", "pw2", &s).unwrap();
        save_at(&file, "key:k1:passphrase", "pw3", &s).unwrap();
        assert_eq!(load_at(&file, "a:password", &s).unwrap().as_deref(), Some("pw1"));
        assert_eq!(load_at(&file, "b:passphrase", &s).unwrap().as_deref(), Some("pw2"));
        assert_eq!(
            load_at(&file, "key:k1:passphrase", &s).unwrap().as_deref(),
            Some("pw3")
        );
    }

    #[test]
    fn save_overwrites_existing() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        let s = fixed_salt();
        save_at(&file, "a:password", "old", &s).unwrap();
        save_at(&file, "a:password", "new", &s).unwrap();
        assert_eq!(load_at(&file, "a:password", &s).unwrap().as_deref(), Some("new"));
    }

    #[test]
    fn delete_removes_only_target() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        let s = fixed_salt();
        save_at(&file, "a:password", "pw1", &s).unwrap();
        save_at(&file, "b:password", "pw2", &s).unwrap();
        delete_at(&file, "a:password", &s).unwrap();
        assert!(load_at(&file, "a:password", &s).unwrap().is_none());
        assert_eq!(load_at(&file, "b:password", &s).unwrap().as_deref(), Some("pw2"));
    }

    #[test]
    fn delete_nonexistent_is_noop() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        delete_at(&file, "nope", &fixed_salt()).unwrap();
        assert!(!file.exists());
    }

    #[cfg(unix)]
    #[test]
    fn written_file_has_0600_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        save_at(&file, "a", "b", &fixed_salt()).unwrap();
        let mode = fs::metadata(&file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "credentials.json must be chmod 600");
    }

    #[test]
    fn empty_file_read_ok() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        fs::write(&file, "").unwrap();
        assert!(load_at(&file, "x", &fixed_salt()).unwrap().is_none());
    }

    #[test]
    fn whitespace_only_file_read_ok() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        fs::write(&file, "   \n  \t").unwrap();
        assert!(load_at(&file, "x", &fixed_salt()).unwrap().is_none());
    }

    #[test]
    fn corrupt_file_returns_error() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        fs::write(&file, "not json {{{").unwrap();
        assert!(load_at(&file, "x", &fixed_salt()).is_err());
    }

    #[test]
    fn ciphertext_is_not_plaintext() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        save_at(&file, "sess1:password", "hunter2", &fixed_salt()).unwrap();
        let on_disk = fs::read_to_string(&file).unwrap();
        assert!(
            !on_disk.contains("hunter2"),
            "secret leaked in plaintext: {}",
            on_disk
        );
        assert!(on_disk.contains("\"v\""));
        assert!(on_disk.contains("\"ct\""));
        assert!(on_disk.contains("\"v\": 3") || on_disk.contains("\"v\":3"));
    }

    #[test]
    fn migrates_legacy_plaintext_on_read() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        let s = fixed_salt();
        // 旧格式：直接 BTreeMap<String,String>
        fs::write(
            &file,
            r#"{"sess1:password":"oldsecret","ai:p1:apikey":"sk-old"}"#,
        )
        .unwrap();
        // 第一次读触发迁移
        assert_eq!(
            load_at(&file, "sess1:password", &s).unwrap().as_deref(),
            Some("oldsecret")
        );
        let on_disk = fs::read_to_string(&file).unwrap();
        assert!(!on_disk.contains("oldsecret"));
        assert!(!on_disk.contains("sk-old"));
        assert_eq!(
            load_at(&file, "ai:p1:apikey", &s).unwrap().as_deref(),
            Some("sk-old")
        );
    }

    #[test]
    fn tampered_ciphertext_fails_to_load() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        save_at(&file, "a", "b", &fixed_salt()).unwrap();
        let mut text = fs::read_to_string(&file).unwrap();
        let pos = text.find("\"ct\"").unwrap();
        let bytes = unsafe { text.as_bytes_mut() };
        let start = pos + 6;
        if bytes[start] == b'A' {
            bytes[start] = b'B';
        } else {
            bytes[start] = b'A';
        }
        fs::write(&file, &text).unwrap();
        assert!(load_at(&file, "a", &fixed_salt()).is_err());
    }

    #[test]
    fn wrong_master_salt_fails_to_decrypt() {
        // 关键不变量：换 master_salt → 同一 ciphertext 解不开
        let dir = tempdir().unwrap();
        let file = dir.path().join("credentials.json");
        save_at(&file, "a", "b", &fixed_salt()).unwrap();
        let mut other = fixed_salt();
        other[0] ^= 0xFF;
        assert!(load_at(&file, "a", &other).is_err());
    }

    #[test]
    fn master_salt_persists_and_is_chmod_600() {
        let dir = tempdir().unwrap();
        let salt_path = dir.path().join(".master_salt");
        let s1 = load_or_init_master_salt(&salt_path).unwrap();
        let s2 = load_or_init_master_salt(&salt_path).unwrap();
        assert_eq!(s1, s2, "subsequent reads must return same salt");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&salt_path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        // 真随机的概率：32B 全零基本不可能
        assert_ne!(s1, [0u8; 32]);
    }
}
