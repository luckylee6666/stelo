# Stelo 安全模型

本文档说明 Stelo 在凭据保护、网络访问、IPC 隔离等方面的设计，以及当前已知的剩余风险。SSH 工具是命脉级软件——我们把所有决策摊开来给你看，而不是让你"相信"。

如果你觉得这套设计不够、或者发现具体问题，请在 README 里找联系方式直接告诉我们；下一节有正式的安全报告渠道。

---

## 1. 威胁模型

我们考虑的攻击场景（从严重到次要）：

| 攻击者 | 能力 | 防御目标 |
|---|---|---|
| **本地非 root 用户** | 同主机其他登录用户 | 读不到私钥 / 密码 / API key / 命令历史 |
| **同步/备份工具** | 把 `~/Library/Application Support/com.lucky.stelo/` 整个搬到 iCloud / Dropbox / Time Machine 备份 | 拷出去后无法解密；本机仍可正常使用 |
| **跨机器横向** | 攻击者拿到完整 app_data 目录（不限手段）后搬到自己的机器 | 解密失败（hostname/uid 不匹配） |
| **前端 XSS / 注入** | 通过 AI 输出、剪贴板、依赖供应链注入恶意 JS | 调不到任意 Tauri 命令，外发不到攻击者域名 |
| **中间人攻击者** | 劫持 SSH 连接，替换 host key | 用户必须显式确认指纹才能连接 |
| **AI provider 自身** | 第三方 LLM 服务（Anthropic / OpenAI 等） | 永远拿不到用户的密码 / token / API key |

**不在威胁模型内**（OS 信任边界外，无法防御）：

- 同主机的 root 用户
- 物理访问 + 解锁的用户态进程内存
- macOS 系统级密钥泄露
- 用户主动把密码 / 私钥粘贴给 AI

---

## 2. 凭据存储（密码 / passphrase / API key）

文件位置：`~/Library/Application Support/com.lucky.stelo/credentials.json`，`chmod 600`。

格式（v3，当前）：
```jsonc
{
  "v": 3,
  "salt": "<32 hex chars>",   // 每次写入随机 16B
  "nonce": "<24 hex chars>",  // 每次写入随机 12B
  "ct": "<base64>"            // AES-256-GCM 密文
}
```

加密链：
```
machine_ikm  = "stelo:v3:" || hostname || ":" || uid || ":com.lucky.stelo"
master_salt  = ~/Library/Application Support/com.lucky.stelo/.master_salt   (32B 真随机, chmod 600, 安装首启生成)
key          = Argon2id(password = machine_ikm || master_salt,
                         salt = per-record-salt,
                         m = 64MiB, t = 3, p = 4) -> 32B
ciphertext   = AES-256-GCM(key, nonce, plaintext = JSON({account: secret, ...}))
```

**抵抗的攻击：**

- 偷 `credentials.json`，缺 `master_salt` → 解不开
- 偷 `master_salt`，缺机器 IKM → 解不开
- 把整个 app_data 拷到别的机器 → hostname/uid 变了，解不开
- 暴力破解 IKM（hostname 可猜，uid 范围小） → Argon2id 64MiB/3轮/4并发：单次 ~150ms，对已知 host:uid 暴力可行但**需要先拿到 master_salt 否则毫无意义**
- 篡改密文 → AES-GCM tag 校验失败，加载报错

**剩余风险：**

- App 运行中，明文凭据短暂存在内存（已 `Zeroizing<String>` 包裹，drop 时清零）。被 attached debugger 仍可读出
- 同主机 root 可读所有文件，无法防御

---

## 3. 内存清零

- `SshAuth::Password.password` 和 `SshAuth::PrivateKey.passphrase` 用 `Zeroizing<String>` 包裹
- `exec_sudo` 把密码缓冲发送给 SSH channel 后 **显式 `zeroize()`**
- `credential_save` 的 `secret` 参数函数返回前 `zeroize()`
- 派生的 AES key 在每次加解密后 `zeroize()`

russh 的 `authenticate_password` API 按值消费 `String`，无法避免一次 clone；那一份在 russh 内部生命周期，我们不能直接控制——已是 Rust SSH 生态的现状。

---

## 4. 主机密钥（host key）

文件：`known_hosts.json`，`chmod 600`。

- **首次连接**：返回 `HOSTKEY_UNVERIFIED` 错误 + 指纹，前端弹琥珀色对话框，用户必须点"指纹一致，信任并连接"才落库
- **后续连接**：指纹匹配则直通；不匹配返回 `HOSTKEY_MISMATCH`，前端弹红色 MITM 警告，用户可选"信任新密钥"覆盖（典型场景：服务器重装）
- 文件不存外部 known_hosts 兼容格式，仅存 SHA256 指纹和 key_type

---

## 5. 私钥文件权限

加载用户的 `~/.ssh/id_*` 私钥前，跟 OpenSSH / 商业 SSH 客户端一样校验 Unix 权限位：

- `0600` / `0400` 接受
- group/other 任意位为非零 → 拒绝加载，提示 `chmod 600 <path>`

---

## 6. CSP + Tauri Isolation Pattern

### CSP（生效于生产构建）

```
default-src 'self' ipc: http://ipc.localhost;
script-src  'self' 'wasm-unsafe-eval';
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob:;
font-src    'self' data:;
connect-src 'self' ipc: http://ipc.localhost ws://localhost:* ws://127.0.0.1:*;
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
form-action 'none';
```

**结果**：浏览器侧 fetch / WebSocket 只能连 IPC + localhost。外部 AI provider / SSH 流量全部经 Rust 后端代理（`tauriFetch`），XSS 找不到外发通道。

### Isolation Pattern

主前端跑在独立 origin 的 sandbox iframe 里。所有 IPC 在到 Rust core 之前先经过 `isolation/index.js`：

1. **命令名白名单**：`ALLOWED_COMMANDS` 集合，未列出的 `cmd` 直接 reject
2. **形状校验**：`SHAPE_CHECKS[cmd]` 做必要字段类型检查（不读 secret 内容，只看形状）
3. 通过后透传给 core；不通过则抛错回主前端

**意义**：即使主前端被 XSS 完全突破（比如恶意 npm 包），攻击者也调不出白名单外的命令——下游每个命令的 capability 边界都在 isolation 层做了二次约束。

---

## 7. 命令历史 / AI prompt 脱敏

入库前正则过滤（`src/lib/redact.ts`）：

| 类别 | 形态 |
|---|---|
| URL 凭据 | `https://user:password@host` |
| HTTP Authorization | `Authorization: Bearer/Basic/Token <value>` |
| `key=value` | `password=` / `token=` / `api_key=` / `secret=` / `aws_secret_access_key=` 等 |
| CLI 长选项 | `--password`/`--token`/`--api-key` `<value>` |
| MySQL/Redis 短选项 | `-p<password>` / `-p <password>` |
| AWS access key | `AKIA...` / `ASIA...` 字面值 |
| GitHub PAT | `ghp_` / `gho_` / `ghs_` / `ghu_` / `ghr_` |
| Anthropic / OpenAI | `sk-ant-...` / `sk-...` |
| JWT | `eyJ...eyJ...sig` 三段 base64url |

**AI 严格模式**（默认开，可关）：检测到任意命中规则时，整段命令输出对 AI provider **屏蔽**，只发结构化提示 `[🛡 SENSITIVE_OUTPUT_BLOCKED]`。即使脱敏正则有疏漏，敏感字段也不会进 prompt。

---

## 8. 审计与速率限制

文件：`audit.log`，JSONL 格式，`chmod 600`，10MB 滚动到 `audit.log.1`。

记录字段：`{ts, kind, detail, ok}`，绝不写 secret 值——只写"哪个 account / 哪台 host"等结构化键。

**速率限制**：`credential_load` 每 account 60 秒内最多 6 次。超限返回错误并写一条 `credential_rate_block` 审计。XSS 即使能调 invoke 也无法快速 siphon 所有凭据。

---

## 9. 文件权限矩阵

| 文件 | 权限 | 内容 |
|---|---|---|
| `credentials.json` | 0600 | 加密的密码 / passphrase / API key |
| `.master_salt` | 0600 | 32B 真随机 KDF 盐源 |
| `known_hosts.json` | 0600 | host:port → 指纹映射 |
| `audit.log` | 0600 | append-only JSONL 审计流 |
| `sessions.json` / `keys.json` / `groups.json` / `snippets.json` / `history.json` / `ai_providers.json` | 0600 | 会话清单 / 密钥引用 / 命令历史等元数据（不含密码） |

---

## 10. 配置导入导出的攻击面收敛

通用读写命令 `local_read_text` / `local_write_text` 已全部移除。

`config_export_file` / `config_import_file` 仅接受：

- 绝对路径
- `.json` 后缀
- 不含 `..`
- 不在 `/.ssh/` / `/.aws/` / `/.gnupg/` / `/Library/Keychains/` / `/etc/` 等敏感目录
- 不是 Stelo 自身的 `credentials.json` / `known_hosts.json`

XSS 即使绕过 isolation 调到这两个命令，也读不到 `~/.ssh/id_rsa`、`~/.aws/credentials` 等文件。

---

## 11. 已知未实现 / 计划中

| 项 | 现状 | 计划 |
|---|---|---|
| **ssh-agent 风格私钥独立进程** | 私钥载入主进程（已 zeroize） | 长期计划：独立 agent 子进程持密钥，主进程只能问签名 |
| **代码签名 + Notarization** | 未签 | 已立项，缺 Apple Developer $99/年订阅 |
| **自动更新** | 无 | Tauri updater，下一阶段 |
| **macOS Keychain 集成（可选）** | 不用 | 用户可在未来设置里选"也复制到 Keychain"（一次授权弹窗） |

---

## 12. 报告安全问题

如果你发现可能的漏洞，请**不要**在公开 issue 提交。

- 邮件：通过 README 中的联系方式
- 主题以 `[SECURITY]` 开头
- 描述：复现步骤 / 影响范围 / 建议修复

我们承诺 72 小时内回复，对负责任披露的研究者会在修复后致谢。

---

## 13. 安全相关测试

```bash
# 加密 / 迁移 / 篡改检测 / 错误 master_salt → 解密失败 / 私钥权限校验
cd src-tauri && cargo test --lib

# 脱敏规则 + 严格模式
pnpm vitest run
```

当前测试覆盖：
- credentials.rs：15 个（含 Argon2id KDF / v2→v3 迁移 / 篡改检测 / 错误 salt / chmod 600）
- audit.rs：6 个（append / chmod / rotation / 速率限制各场景）
- ssh.rs：11 个（含私钥权限 0600/0400/0644/0640 各组合）
- redact.test.ts：19 个（各类 token 形态 + 报告模式）

---

文档版本：v0.1.x · 2026-04-27
