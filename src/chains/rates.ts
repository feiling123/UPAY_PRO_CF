import type { Env } from "../types";
import { rateToScaled } from "../lib/money";

export async function fetchOkxRateScaled(symbol: "USDT" | "USDC" | "TRX"): Promise<number | null> {
  const url = new URL("https://www.okx.com/v4/c2c/express/price");
  url.searchParams.set("crypto", symbol);
  url.searchParams.set("fiat", "CNY");
  url.searchParams.set("side", "sell");
  const response = await fetch(url, { headers: { "User-Agent": "UPay-Pro-Cloudflare/0.1" } });
  if (!response.ok) return null;
  const data = await response.json<{ data?: { price?: string } }>();
  return rateToScaled(data.data?.price || "");
}

export function apiKeysConfigured(env: Env): boolean {
  return Boolean(env.TRONSCAN_API_KEY || env.TRONGRID_API_KEY || env.ETHERSCAN_API_KEY);
}
