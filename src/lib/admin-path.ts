import type { Env } from "../types";

export function adminPublicPath(env: Pick<Env, "ADMIN_PATH">): string | null {
  const raw = String(env.ADMIN_PATH || "").trim();
  if (!raw) return null;
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
  const normalized = prefixed.replace(/\/+$/g, "");
  if (!normalized || normalized === "/") return null;
  if (!/^\/[A-Za-z0-9/_-]{3,128}$/.test(normalized)) return null;
  const reserved = ["/api", "/pay", "/assets", "/js", "/vendor", "/login", "/login.html", "/admin", "/admin.html", "/index.html"];
  if (reserved.some((path) => normalized === path || normalized.startsWith(`${path}/`))) return null;
  return normalized;
}
