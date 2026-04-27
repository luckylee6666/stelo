// 命令历史 / AI prompt 入库前脱敏。只覆盖**字面常见**的几类——保守且不破坏可读性。
// 真要藏住敏感内容，最终还是需要用户自觉；这层只挡掉"误粘 token / curl -H Bearer"这种典型。
//
// 命中即替换为 ***（不暴露原值长度）。返回结果不保证可执行——脱敏后命令本就不该再被回放。

const RULES: Array<{ re: RegExp; replace: string }> = [
  // URL 中的 user:password — protocol://user:password@host
  {
    re: /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/g,
    replace: "$1$2:***@",
  },
  // Authorization / Bearer / Basic
  { re: /\b(Authorization\s*:\s*)(Bearer|Basic|Token)\s+\S+/gi, replace: "$1$2 ***" },
  { re: /\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]{8,}/g, replace: "$1 ***" },
  // key=value 形式的常见敏感名
  {
    re: /\b(password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|aws[_-]?secret[_-]?access[_-]?key|aws[_-]?access[_-]?key[_-]?id)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi,
    replace: "$1=***",
  },
  // CLI 长选项形式 --password=xxx / --password xxx / --token xxx
  {
    re: /(--(?:password|passwd|passphrase|secret|token|api[_-]?key))(?:[=\s]+)("[^"]*"|'[^']*'|\S+)/gi,
    replace: "$1 ***",
  },
  // mysql/redis 风格 -p<password>（紧贴）和 -p <password>
  { re: /(\s-p)([^\s=][^\s]*)/g, replace: "$1***" },
  // AWS access key 字面值（AKIA / ASIA 开头 16 位以上）和密钥 base64-ish
  { re: /\b(AKIA|ASIA)[A-Z0-9]{12,}\b/g, replace: "$1***" },
  // GitHub token: ghp_ / gho_ / ghu_ / ghs_ / ghr_ + 36+ 字符
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replace: "gh*_***" },
  // OpenAI / Anthropic 风格：sk-... / sk-ant-...
  { re: /\bsk-(?:ant-)?[A-Za-z0-9_\-]{16,}\b/g, replace: "sk-***" },
  // 通用 JWT（三段 base64url）
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replace: "eyJ***" },
];

export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const { re, replace } of RULES) {
    out = out.replace(re, replace);
  }
  return out;
}

export type RedactionReport = {
  text: string;
  /** 命中的规则数（命中即非零）。前端可据此提示用户/AI"输出含敏感数据已脱敏" */
  hits: number;
};

export function redactWithReport(input: string): RedactionReport {
  if (!input) return { text: input, hits: 0 };
  let out = input;
  let hits = 0;
  for (const { re, replace } of RULES) {
    // 用全局 RegExp 计数命中：每条规则单独算一次匹配批次
    const before = out;
    out = out.replace(re, replace);
    if (out !== before) hits += 1;
  }
  return { text: out, hits };
}
