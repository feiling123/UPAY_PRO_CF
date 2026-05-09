import { z } from "zod";
import { hmacSha256Hex, md5Hex, timingSafeEqual } from "./crypto";
import type { Env } from "../types";
import { requiredSecret } from "./secrets";

export const createOrderSchema = z.object({
  type: z.string().min(1),
  order_id: z.string().min(1).max(128),
  amount: z.number().positive(),
  notify_url: z.string().url(),
  redirect_url: z.string().url(),
  signature: z.string().min(16),
  merchant_id: z.string().max(80).optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  nonce: z.string().max(128).optional()
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export function legacyCreateOrderString(input: CreateOrderInput, secret: string): string {
  const params = [
    `type=${input.type}`,
    `amount=${goPercentG(input.amount)}`,
    `notify_url=${input.notify_url}`,
    `order_id=${input.order_id}`,
    `redirect_url=${input.redirect_url}`
  ];
  params.sort();
  return `${params.join("&")}${secret}`;
}

export function legacyCallbackString(data: {
  trade_id: string;
  order_id: string;
  amount: number;
  actual_amount: number;
  token: string;
  block_transaction_id: string;
  status: number;
}, secret: string): string {
  const params = [
    `trade_id=${data.trade_id}`,
    `order_id=${data.order_id}`,
    `amount=${goPercentG(data.amount)}`,
    `actual_amount=${goPercentG(data.actual_amount)}`,
    `token=${data.token}`,
    `block_transaction_id=${data.block_transaction_id}`,
    `status=${data.status}`
  ];
  params.sort();
  return `${params.join("&")}${secret}`;
}

export function signLegacyCreateOrder(input: CreateOrderInput, secret: string): string {
  return md5Hex(legacyCreateOrderString(input, secret));
}

export function signLegacyCallback(data: Parameters<typeof legacyCallbackString>[0], secret: string): string {
  return md5Hex(legacyCallbackString(data, secret));
}

export async function verifyCreateOrderSignature(input: CreateOrderInput, secret: string, version: string | null): Promise<boolean> {
  if (version === "v2") {
    if (!input.timestamp || !input.nonce) return false;
    const timestamp = Number(input.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) return false;
    const signed = [
      `amount=${goPercentG(input.amount)}`,
      `merchant_id=${input.merchant_id || "default"}`,
      `nonce=${input.nonce}`,
      `notify_url=${input.notify_url}`,
      `order_id=${input.order_id}`,
      `redirect_url=${input.redirect_url}`,
      `timestamp=${Math.trunc(timestamp)}`,
      `type=${input.type}`
    ].sort().join("&");
    const expected = await hmacSha256Hex(secret, signed);
    return timingSafeEqual(expected, input.signature.toLowerCase());
  }
  const expected = signLegacyCreateOrder(input, secret);
  return timingSafeEqual(expected, input.signature.toLowerCase());
}

export async function signViewToken(env: Env, tradeId: string, expiresAtMs: number): Promise<string> {
  const secret = requiredSecret("ADMIN_JWT_SECRET", env.ADMIN_JWT_SECRET);
  const body = `${tradeId}.${expiresAtMs}`;
  const sig = await hmacSha256Hex(secret, body);
  return `${expiresAtMs}.${sig}`;
}

export async function verifyViewToken(env: Env, tradeId: string, token: string | null, storedHash: string): Promise<boolean> {
  if (!(await verifyViewTokenSignature(env, tradeId, token))) return false;
  return timingSafeEqual(md5Hex(token as string), storedHash);
}

export async function verifyViewTokenSignature(env: Env, tradeId: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  const [expiresRaw, sig] = token.split(".");
  const expiresAtMs = Number(expiresRaw);
  if (!expiresRaw || !sig || token.split(".").length !== 2) return false;
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs + 60_000) return false;
  const expected = await signViewToken(env, tradeId, expiresAtMs);
  return timingSafeEqual(expected, token);
}

export function hashViewToken(token: string): string {
  return md5Hex(token);
}

function goPercentG(amount: number): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0) {
    const exponent = Math.floor(Math.log10(abs));
    if (exponent < -4 || exponent >= 6) {
      const exponential = value.toExponential(15).replace(/(\.\d*?)0+e/, "$1e").replace(/\.e/, "e");
      return exponential.replace(/e([+-])(\d)$/, (_match, sign: string, digit: string) => `e${sign}0${digit}`);
    }
  }
  return value.toString();
}
