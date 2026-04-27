/**
 * 把 SSH / SFTP 操作返回的字符串错误，分类为可操作的诊断条目。
 * 每条返回 { kind, title, hints[] }，UI 渲染图标 + 标题 + 一两句修复建议。
 */

export type DiagKind =
  | "auth"
  | "host_unverified"
  | "host_mismatch"
  | "key_perm"
  | "key_not_found"
  | "key_passphrase"
  | "dns"
  | "timeout"
  | "refused"
  | "network"
  | "permission"
  | "rate_limited"
  | "unknown";

export type Diagnosis = {
  kind: DiagKind;
  title: string;
  hints: string[];
  /** 原始错误字串（已脱敏，可显示给用户） */
  raw: string;
};

const PATTERNS: Array<{
  kind: DiagKind;
  title: string;
  re: RegExp;
  hints: string[];
}> = [
  {
    kind: "auth",
    title: "认证失败",
    re: /authentication failed|auth (?:failed|fail)|invalid (?:password|credentials)/i,
    hints: [
      "检查用户名 / 密码 / 私钥是否正确",
      "如果用密钥登录，确认远端 ~/.ssh/authorized_keys 包含对应公钥",
      "短期反复失败可能触发 fail2ban 锁定",
    ],
  },
  {
    kind: "host_unverified",
    title: "首次连接此主机",
    re: /HOSTKEY_UNVERIFIED/i,
    hints: ["请在弹出的对话框上**核对指纹**后再确认连接（防中间人）"],
  },
  {
    kind: "host_mismatch",
    title: "主机密钥已变更",
    re: /HOSTKEY_MISMATCH/i,
    hints: [
      "服务器重装 / 换机器是常见原因",
      "如果你没动过服务器，**不要信任**——可能是中间人攻击",
    ],
  },
  {
    kind: "key_perm",
    title: "私钥文件权限不安全",
    re: /权限不安全|permissions are too open|chmod 600/i,
    hints: [
      "OpenSSH 要求私钥权限为 0600（仅文件所有者可读）",
      "运行 `chmod 600 ~/.ssh/id_xxx` 后重试",
    ],
  },
  {
    kind: "key_not_found",
    title: "私钥文件不存在",
    re: /key file not found|no such file/i,
    hints: [
      "检查私钥路径是否正确（注意 ~ 展开）",
      "如果是新机器，先把私钥从原机器复制过来",
    ],
  },
  {
    kind: "key_passphrase",
    title: "私钥密码短语错误",
    re: /(?:invalid|incorrect|wrong) (?:passphrase|password for key)/i,
    hints: ["私钥被密码加密；请输入正确的 passphrase"],
  },
  {
    kind: "dns",
    title: "无法解析主机名",
    re: /(?:dns|resolve|name or service not known|nodename nor servname|getaddrinfo)/i,
    hints: [
      "检查主机名拼写是否正确",
      "试试用 IP 地址替代主机名",
      "检查本机 DNS 设置 / VPN 是否影响解析",
    ],
  },
  {
    kind: "timeout",
    title: "连接超时",
    re: /(?:tcp connect timeout|timed? ?out|deadline exceeded)/i,
    hints: [
      "服务器可能没响应：检查防火墙 / 安全组",
      "网络不通：试试 `ping <host>`",
      "端口错误：默认 22，云厂商可能改成其它端口",
    ],
  },
  {
    kind: "refused",
    title: "连接被拒绝",
    re: /connection refused|connect: connection refused/i,
    hints: [
      "目标端口没有 SSH 服务在监听（或服务挂了）",
      "端口号填错了？默认 22，部分服务商改了",
      "在服务端检查 `systemctl status sshd` 是否运行",
    ],
  },
  {
    kind: "network",
    title: "网络问题",
    re: /(?:network is unreachable|no route to host|host is down|broken pipe|connection reset)/i,
    hints: [
      "目标主机不在线 / 路由不通",
      "VPN 状态？防火墙规则？",
      "稍后重试或联系运维",
    ],
  },
  {
    kind: "permission",
    title: "权限不足",
    re: /permission denied(?! \(publickey)/i,
    hints: [
      "目标路径当前用户无读 / 写权限",
      "可以用 sudo 上传（SFTP 已自动检测并提示）",
      "或换到可写目录如 `~/` / `/tmp/`",
    ],
  },
  {
    kind: "rate_limited",
    title: "速率限制触发",
    re: /rate-limited|rate limit/i,
    hints: [
      "短时间内请求过于频繁，已被本地速率限制保护",
      "等 60 秒后重试",
    ],
  },
];

export function diagnoseSshError(raw: string): Diagnosis {
  const safe = raw || "";
  for (const p of PATTERNS) {
    if (p.re.test(safe)) {
      return { kind: p.kind, title: p.title, hints: p.hints, raw: safe };
    }
  }
  return {
    kind: "unknown",
    title: "未知错误",
    hints: ["复制下面的原始错误信息可方便排查"],
    raw: safe,
  };
}
