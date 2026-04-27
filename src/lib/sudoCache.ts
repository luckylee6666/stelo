// 纯内存的 sudo 密码缓存，按 backendId 分桶，TTL 15 分钟。
// 不落盘；App 退出或页面刷新即清空。

type Entry = { password: string; expiresAt: number };
const cache = new Map<string, Entry>();
const DEFAULT_TTL_MS = 15 * 60 * 1000;

export function getCachedSudo(backendId: string): string | null {
  const e = cache.get(backendId);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    cache.delete(backendId);
    return null;
  }
  return e.password;
}

export function setCachedSudo(
  backendId: string,
  password: string,
  ttlMs = DEFAULT_TTL_MS,
): void {
  cache.set(backendId, { password, expiresAt: Date.now() + ttlMs });
}

export function clearCachedSudo(backendId: string): void {
  cache.delete(backendId);
}

export function clearAllCachedSudo(): void {
  cache.clear();
}
