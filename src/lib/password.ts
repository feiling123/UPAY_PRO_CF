import { md5Hex, timingSafeEqual } from "./crypto";

export async function hashPassword(password: string): Promise<string> {
  return `md5$${md5Hex(password)}`;
}

export async function verifyPassword(password: string, stored: unknown): Promise<boolean> {
  if (!isSupportedPasswordHash(stored)) return false;
  const [, hash] = stored.split("$");
  return timingSafeEqual(md5Hex(password), hash);
}

export function isSupportedPasswordHash(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [scheme, iterationsRaw, saltRaw, hashRaw] = value.split("$");
  return scheme === "md5"
    && /^[a-f0-9]{32}$/i.test(iterationsRaw || "")
    && saltRaw === undefined
    && hashRaw === undefined;
}
