import type { Dict } from "./types";

const en: Dict = {
  // ───── Welcome ─────
  "welcome.subtitle": "Modern SSH Terminal · Built-in AI Ops Assistant",
  "welcome.feature.ai.title": "AI Agent",
  "welcome.feature.ai.desc":
    "⌘J to open · installs, troubleshoots, deploys and self-verifies · Claude / OpenAI / DeepSeek / MiniMax",
  "welcome.feature.sftp.title": "SFTP Dual Pane",
  "welcome.feature.sftp.desc":
    "Drag-drop upload · Monaco remote editing · image / Office / text preview · one-click sudo delete",
  "welcome.feature.conn.title": "Instant Connect",
  "welcome.feature.conn.desc":
    "Password / key / port forwarding · OSC 7 cwd sync · press Enter to auto-reconnect",
  "welcome.feature.sec.title": "Security",
  "welcome.feature.sec.desc":
    "known_hosts fingerprint TOFU · MITM alert on key change · credentials chmod 600 locally",
  "welcome.feature.cmd.title": "Command Palette",
  "welcome.feature.cmd.desc":
    "⌘K to open · snippet library + command history fuzzy search · sorted by frequency",
  "welcome.feature.theme.title": "Themes & Customization",
  "welcome.feature.theme.desc":
    "6 built-in themes · custom 21-color editor · input sync · one-click config export / import",
  "welcome.secondary.font": "⌘+/- font size",
  "welcome.secondary.tabs": "Multi-session tabs",
  "welcome.secondary.forward": "Port forwarding -L",
  "welcome.secondary.group": "Session groups / color tags",
  "welcome.secondary.creds": "Secure local credential store",
  "welcome.secondary.themes": "Dark / light themes",
  "welcome.kbd.newSession": "New session",
  "welcome.kbd.palette": "Command palette",
  "welcome.kbd.ai": "AI assistant",
  "welcome.kbd.find": "Terminal find",

  // ───── Sidebar ─────
  "sidebar.searchPlaceholder": "Search sessions…",
  "sidebar.newSession": "New Session",
  "sidebar.ungrouped": "Ungrouped",
  "sidebar.empty": "No sessions yet",
  "sidebar.btn.keys": "Keys",
  "sidebar.btn.groups": "Groups",
  "sidebar.btn.snippets": "Snippets",
  "sidebar.btn.snippets.tip": "Snippets (⌘K also works)",
  "sidebar.btn.ai": "AI",
  "sidebar.btn.ai.tip": "AI assistant (⌘J)",
  "sidebar.btn.hosts": "Hosts",
  "sidebar.btn.hosts.tip": "Trusted host keys (known_hosts)",
  "sidebar.btn.backup": "Backup",
  "sidebar.btn.backup.tip": "Export / import config (move machines, share with friends)",

  // ───── TabBar ─────
  "tab.close.ssh": "Close connection (keep in sidebar)",
  "tab.close.local": "Close",
  "tab.syncInput": "Sync input",

  // ───── StatusBar ─────
  "status.cpu": "CPU",
  "status.mem": "MEM",
  "status.load": "LOAD",
  "status.net": "NET",
  "status.cwd": "CWD",

  // ───── TerminalView ─────
  "term.connected": "Connected to",
  "term.session": "session",
  "term.auth.key": "key",
  "term.auth.pwd": "password",
  "term.closed": "Connection closed",
  "term.reconnecting": "Reconnecting…",
  "term.reconnectHint": "Press Enter to auto-reconnect…",

  // ───── Common ─────
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.delete": "Delete",
  "common.ok": "OK",
  "common.close": "Close",
  "common.save": "Save",
  "common.edit": "Edit",
  "common.refresh": "Refresh",
  "common.loading": "Loading…",
  "common.retry": "Retry",

  // ───── Theme names ─────
  "theme.neutral": "Neutral Dark",
  "theme.dracula": "Dracula",
  "theme.solarized-dark": "Solarized Dark",
  "theme.tokyo-night": "Tokyo Night",
  "theme.gruvbox-dark": "Gruvbox Dark",
  "theme.solarized-light": "Solarized Light",
  "theme.stelo-light": "Stelo Light",
  "theme.stelo-dark": "Stelo Dark",
  "theme.menu.auto": "Auto",
  "theme.menu.builtin": "Built-in",
  "theme.menu.custom": "Custom",
  "theme.menu.system": "Follow system (dark / light)",
  "theme.menu.systemPrefix": "System",
  "theme.menu.newCustom": "+ New custom theme…",
  "theme.menu.editTheme": "Edit theme",

  // ───── Language switch ─────
  "lang.auto": "Follow system",
  "lang.zh": "简体中文",
  "lang.en": "English",
  "lang.menu": "Language",
};

export default en;
