import type { Dict } from "./types";

const zh: Dict = {
  // ───── Welcome ─────
  "welcome.subtitle": "现代 SSH 终端 · 内置 AI 运维助手",
  "welcome.feature.ai.title": "AI Agent",
  "welcome.feature.ai.desc":
    "⌘J 呼出 · 自动装软件 / 排错 / 部署，跑完自己验证；支持 Claude / OpenAI / DeepSeek / MiniMax 等",
  "welcome.feature.sftp.title": "SFTP 双栏",
  "welcome.feature.sftp.desc":
    "拖拽上传 · Monaco 远端编辑 · 图片 / Office / 文本预览 · sudo 一键删除带权限路径",
  "welcome.feature.conn.title": "连接即刻",
  "welcome.feature.conn.desc":
    "密码 / 私钥 / 端口转发 · OSC 7 自动同步 cwd · 断线按回车即重连",
  "welcome.feature.sec.title": "安全防护",
  "welcome.feature.sec.desc":
    "known_hosts 指纹 TOFU · 密钥变更弹 MITM 警告 · 凭据 chmod 600 本地存",
  "welcome.feature.cmd.title": "命令面板",
  "welcome.feature.cmd.desc":
    "⌘K 呼出 · 快捷指令库 + 命令历史模糊搜索 · 按频次排序",
  "welcome.feature.theme.title": "主题与定制",
  "welcome.feature.theme.desc":
    "6 套内置主题 · 自定义 21 色编辑器 · 同步输入 · 配置一键导出 / 导入",
  "welcome.secondary.font": "⌘+/- 字号",
  "welcome.secondary.tabs": "多会话标签",
  "welcome.secondary.forward": "端口转发 -L",
  "welcome.secondary.group": "会话分组 / 颜色标签",
  "welcome.secondary.creds": "凭据安全本地存",
  "welcome.secondary.themes": "暗色 / 亮色主题",
  "welcome.cta.newSession": "添加第一个会话",
  "welcome.cta.shortcuts": "快捷键速查",
  "welcome.kbd.newSession": "新建会话",
  "welcome.kbd.palette": "命令面板",
  "welcome.kbd.ai": "AI 助手",
  "welcome.kbd.find": "终端查找",

  // ───── Sidebar ─────
  "sidebar.searchPlaceholder": "搜索会话…",
  "sidebar.newSession": "新建会话",
  "sidebar.ungrouped": "未分组",
  "sidebar.empty": "暂无会话",
  "sidebar.btn.keys": "密钥",
  "sidebar.btn.groups": "分组",
  "sidebar.btn.snippets": "指令",
  "sidebar.btn.snippets.tip": "快捷指令（⌘K 也能呼出）",
  "sidebar.btn.ai": "AI 助手",
  "sidebar.btn.ai.tip": "AI 助手（⌘J 呼出）",
  "sidebar.btn.hosts": "主机",
  "sidebar.btn.hosts.tip": "已信任的主机密钥（known_hosts）",
  "sidebar.btn.backup": "备份",
  "sidebar.btn.backup.tip": "配置导出 / 导入（换机器或给朋友分享）",

  // ───── TabBar ─────
  "tab.close.ssh": "关闭连接（保留在侧栏）",
  "tab.close.local": "关闭",
  "tab.syncInput": "同步输入",

  // ───── StatusBar ─────
  "status.cpu": "CPU",
  "status.mem": "MEM",
  "status.load": "LOAD",
  "status.net": "NET",
  "status.cwd": "CWD",

  // ───── TerminalView 连接消息 ─────
  "term.connected": "已连接到",
  "term.session": "session",
  "term.auth.key": "密钥",
  "term.auth.pwd": "密码",
  "term.closed": "连接已关闭",
  "term.reconnecting": "正在重连…",
  "term.reconnectHint": "按回车自动重连…",

  // ───── 通用 ─────
  "common.cancel": "取消",
  "common.confirm": "确认",
  "common.delete": "删除",
  "common.ok": "确定",
  "common.close": "关闭",
  "common.save": "保存",
  "common.edit": "编辑",
  "common.refresh": "刷新",
  "common.loading": "加载中…",
  "common.retry": "重试",

  // ───── 主题名 ─────
  // 专有名词（Dracula / Solarized / Tokyo Night / Gruvbox）保留英文
  // 加中文后缀只标深浅，不翻译品牌
  "theme.neutral": "Neutral 暗色",
  "theme.dracula": "Dracula 暗色",
  "theme.solarized-dark": "Solarized 暗色",
  "theme.tokyo-night": "Tokyo 暗色",
  "theme.gruvbox-dark": "Gruvbox 暗色",
  "theme.solarized-light": "Solarized 亮色",
  "theme.stelo-light": "Stelo 亮色",
  "theme.stelo-dark": "Stelo 暗色",
  "theme.menu.auto": "自动",
  "theme.menu.builtin": "内置",
  "theme.menu.custom": "自定义",
  "theme.menu.system": "跟随系统（深 / 浅自动切换）",
  "theme.menu.systemPrefix": "跟随系统",
  "theme.menu.newCustom": "+ 新建自定义主题…",
  "theme.menu.editTheme": "编辑主题",

  // ───── 语言切换 ─────
  "lang.auto": "跟随系统",
  "lang.zh": "简体中文",
  "lang.en": "English",
  "lang.menu": "语言",
};

export default zh;
