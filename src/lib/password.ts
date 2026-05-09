import { base64UrlDecode, base64UrlEncode, timingSafeEqual } from "./crypto";

const encoder = new TextEncoder();
const ITERATIONS = 120_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(password, salt);
  return `pbkdf2-sha256$${ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(key)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsRaw, saltRaw, hashRaw] = stored.split("$");
  if (scheme !== "pbkdf2-sha256") return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const salt = base64UrlDecode(saltRaw);
  const expected = hashRaw;
  const actual = base64UrlEncode(await derive(password, salt, iterations));
  return timingSafeEqual(actual, expected);
}

async function derive(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer, iterations },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}
