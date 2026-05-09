import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import type { Env } from "../types";
import { adminPublicPath } from "./admin-path";
import { base64UrlDecode, base64UrlEncode, hmacSha256Hex, timingSafeEqual } from "./crypto";
import { jsonMessage, noStoreHeaders } from "./http";
import { requiredSecret } from "./secrets";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const COOKIE_NAME = "upay_admin";

export interface SessionClaims {
  sub: string;
  username: string;
  role: string;
  exp: number;
}

export async function createSession(env: Env, claims: Omit<SessionClaims, "exp">, ttlSeconds = 86_400): Promise<string> {
  const payload: SessionClaims = {
    ...claims,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const payloadRaw = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = await hmacSha256Hex(sessionSecret(env), payloadRaw);
  return `${payloadRaw}.${sig}`;
}

export async function verifySession(env: Env, token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  const [payloadRaw, sig] = token.split(".");
  if (!payloadRaw || !sig) return null;
  const expected = await hmacSha256Hex(sessionSecret(env), payloadRaw);
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const claims = JSON.parse(decoder.decode(base64UrlDecode(payloadRaw))) as SessionClaims;
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function requireAdmin(c: Context<{ Bindings: Env; Variables: { session?: SessionClaims } }>, next: Next): Promise<Response | void> {
  const session = await optionalAdminSession(c);
  if (!session) return jsonMessage(c, "未登录", 401, -1);
  await next();
}

export async function requireAdminPage(c: Context<{ Bindings: Env; Variables: { session?: SessionClaims } }>, next: Next): Promise<Response | void> {
  const session = await optionalAdminSession(c);
  if (!session) return c.redirect(adminPublicPath(c.env) || "/");
  await next();
}

export async function optionalAdminSession(c: Context<{ Bindings: Env; Variables: { session?: SessionClaims } }>): Promise<SessionClaims | null> {
  const session = await verifySession(c.env, getCookie(c, COOKIE_NAME));
  if (session) c.set("session", session);
  return session;
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 86_400
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

export function securityHeaders(): Record<string, string> {
  return {
    ...noStoreHeaders(),
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}

function sessionSecret(env: Env): string {
  return requiredSecret("ADMIN_JWT_SECRET", env.ADMIN_JWT_SECRET);
}
