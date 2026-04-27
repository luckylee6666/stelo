# Stelo

**现代 SSH 终端 · 内置 AI 运维助手**

Stelo 是一款以"小白也能上手"为目标的跨平台 SSH 客户端，和 Termius / Tabby / XShell 同赛道，差异化在**内置 Claude / OpenAI / DeepSeek / MiniMax 等多家 AI 的 Agent 模式**——能自动装软件、排查故障、部署应用，跑完还会自己验证。

> 名字来源：世界语 "Stelo" = 星，寓意"连接星河间的服务器"。

---

## ✨ 核心功能

### 🤖 AI Agent（核心差异点）
- `⌘J` 呼出底部抽屉，不挡终端
- 原生 **tool_use 协议** + 流式回复，告别正则提代码块的不稳定
- 支持 Claude / OpenAI / DeepSeek / Kimi / 通义 / Ollama / **MiniMax Token Plan**（Anthropic 兼容）
- **附件上传**：📎 选本地文件 / 📁 整棵目录递归 SFTP 上传到 /tmp/，AI 直接 cat / bash
- **交互提示识别**：检测到 `[sudo] password for ...` / `[y/N]` / SSH passphrase 等，弹醒目提示让用户去终端输入，AI 不再瞎发命令
- **失败重试 + 换 Provider**：529 过载时弹"重试 / 切到 XXX Provider"按钮
- **Agent 历史隔离**：tool_use 富内容块跨轮独立保存，不会被扁平化污染造成 AI 复读

### 🔐 SSH
- 密码 / 私钥（ED25519 / RSA / ECDSA）+ 独立密钥库（多会话复用一把 key）
- **known_hosts 指纹 TOFU**：首次自动记录，后续指纹变化弹红色 MITM 警告
- 端口转发（本地 -L），编辑会话里配规则，连接时自动启动
- 断线后按回车自动重连（用保存的凭据）
- OSC 7 自动同步远端 cwd

### 📁 SFTP 双栏
- 右侧常驻文件面板，拖拽上传
- 远端文件双击用 **Monaco** 直接编辑，⌘S 回写
- 图片 / Office（.docx / .xlsx）/ 文本预览
- 新建目录 / 重命名 / 删除（带二次确认）
- **Permission denied 时弹 sudo 密码对话框**，一键 `sudo -S` 删除；密码仅内存缓存 15 分钟，不落盘

### 🎨 主题与定制
- 8 套内置：**Stelo Light / Stelo Dark**（品牌纯白 / 纯黑）、Neutral / Dracula / Solarized Dark·Light / Tokyo Night / Gruvbox Dark
- 跟随系统深浅色自动切换
- 自定义主题（21 色编辑器）
- 6 级字号 ⌘+/- / ⌘0 重置

### 🌐 国际化
- 中 / 英双语界面
- 跟随系统语言自动切换
- 扩展新语言只需加一份字典文件

### 🛠 工作流
- 多会话标签（⌘T 新建 / ⌘W 关闭）
- 会话分组 + 颜色标签
- 快捷指令库 + 命令历史模糊搜索（`⌘K` 命令面板，按频次排序）
- 多会话同步输入 📡
- 终端查找（`⌘F`，区分大小写 / 全词匹配）
- StatusBar 实时 CPU / MEM / LOAD / NET 展示
- 配置一键导出 / 导入 JSON（换机器或分享给朋友）
- 粘贴 >3 行弹 confirm 防误粘

### 🛡 安全（商用级）
SSH 工具的命脉。详见 [SECURITY.md](./SECURITY.md)。

- **凭据 AES-256-GCM 加密落盘**，密钥经 **Argon2id** 派生（机器派生 IKM ‖ 持久化随机 master_salt），跨机器拷贝不可解
- **私钥 / 密码 内存清零**：`Zeroizing<String>` 包裹，drop 时自动覆写堆缓冲区
- **首次连接强制确认 host key 指纹**：替代静默 TOFU，防中间人
- **私钥文件权限校验**：与 OpenSSH 一致，`~/.ssh/id_rsa` 必须 `0600`
- **Tauri Isolation Pattern**：所有 IPC 经 sandbox iframe 命令名白名单校验
- **严格 CSP**：`connect-src` 只允许 IPC + localhost；外部网络全部经 Tauri 代理
- **命令历史 / AI prompt 自动脱敏**：密码 / token / API key / JWT / AWS key 多类规则；AI 严格模式整段屏蔽
- **本地审计日志**：`audit.log`（`chmod 600`，10MB 滚动）记录敏感操作；`credential_load` 速率限制 6 次/60秒/account
- 所有数据文件 `chmod 600`，不走 macOS Keychain（避免 dev 签名反复弹授权）

---

## 🧱 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Tauri 2.x（Rust 后端 + WebView 前端，dmg ~10MB）|
| 前端 | React 19 + TypeScript + Vite |
| UI | Tailwind v4 + Zustand + Lucide Icons |
| 终端 | xterm.js + addon-webgl / fit / search / unicode11 / web-links |
| SSH / SFTP | russh 0.51 + russh-sftp 2 |
| AI | tauri-plugin-http（绕 WebView CORS）+ Anthropic/OpenAI SSE 流式 |
| 文件编辑 | Monaco（远端）+ SheetJS + mammoth（Office 预览）|

---

## 📦 安装

### macOS (当前版本)

从 `src-tauri/target/release/bundle/dmg/` 拿 `.dmg`，拖进 Applications。

> 未代码签名（Apple Developer $99/年，暂未购买），首次打开需 **右键 → 打开** 绕 Gatekeeper。

### 其他平台

Windows / Linux 打包待后续版本补上（Tauri 本身支持，主要是签名和测试）。

---

## 🚀 开发

```bash
pnpm install
pnpm tauri dev          # 开发模式，HMR + Rust 自动重编
pnpm tauri build        # 构建 release dmg

pnpm tsc --noEmit       # 前端类型检查
pnpm vitest run         # 前端单测（40+）
cd src-tauri && cargo test --lib       # Rust 单测（32）
cd src-tauri && cargo test --lib -- --ignored   # smoke tests（需真实测试服务器）
```

本机依赖（已确认可用）：
- Rust 1.94+（Homebrew）
- Node v23.11.1 + pnpm 10.32.0

---

## 🗺 Roadmap

已完成（v0.1.x）：✅ SSH + SFTP + AI Agent + 主题 + i18n + known_hosts + 配置导出入

下一轮候选：

- [ ] **Windows 打包**（翻倍潜在用户）
- [ ] **代码签名 + Notarization**（去掉首次打开 Gatekeeper 警告）
- [ ] **自动更新**（Tauri updater）
- [ ] **远程 -R / 动态 -D SOCKS5 转发**
- [ ] **本地 shell（portable-pty）** —— 不用 SSH 也能开终端
- [ ] **Zmodem（rz / sz）**
- [ ] **面板分割（水平 / 垂直）+ tmux 风格布局**
- [ ] **会话录制回放 / 导出 GIF / MP4**
- [ ] **SFTP 路径书签**（/opt / /var/log 等一键跳）
- [ ] **Tab 拖拽重排**

---

## 📝 License & 分发

**自用 + 朋友圈分发，暂不开源**。目标是打磨到稳定版先在抖音 / 小红书引流到位，再考虑开源社区路线。

如果你是朋友圈拿到 dmg 的用户，反馈直接找我就行。

---

Made with ☕ and ✦ 紫色星辰，2026。
