const intervalCache = new Map<string, number>();

export function throttleLocal(key: string, minIntervalMs: number): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now();
  const last = intervalCache.get(key) || 0;
  if (now - last < minIntervalMs) {
    return { ok: false, retryAfterMs: minIntervalMs - (now - last) };
  }
  intervalCache.set(key, now);
  if (intervalCache.size > 10_000) {
    for (const oldKey of intervalCache.keys()) {
      intervalCache.delete(oldKey);
      if (intervalCache.size < 5_000) break;
    }
  }
  return { ok: true };
}

export function looksLikeProbe(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes(".env") ||
    lower.includes("wp-login") ||
    lower.includes("xmlrpc") ||
    lower.includes("phpmyadmin") ||
    lower.includes("/.git") ||
    lower.includes("/vendor/phpunit")
  );
}

export function jitterMs(baseMs: number): number {
  return Math.round(baseMs * (1 + Math.random() * 0.2));
}
