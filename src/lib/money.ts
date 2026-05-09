export const CRYPTO_SCALE = 1_000_000;
export const DEFAULT_RATE_SCALE = 1_000_000;
export const DEFAULT_INCREMENT_UNITS = 10_000; // 0.01 token at 6 decimals.

export function parseAmountCents(amount: unknown): number | null {
  if (typeof amount !== "number" && typeof amount !== "string") return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0.01) return null;
  return Math.round(value * 100);
}

export function centsToDecimal(cents: number): number {
  return Math.round(cents) / 100;
}

export function unitsToToken(units: number, scale = CRYPTO_SCALE): number {
  return units / scale;
}

export function formatToken(units: number, scale = CRYPTO_SCALE): string {
  const value = units / scale;
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export function rateToScaled(rate: unknown, scale = DEFAULT_RATE_SCALE): number | null {
  if (typeof rate !== "number" && typeof rate !== "string") return null;
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * scale);
}

export function scaledToRate(rateScaled: number, scale = DEFAULT_RATE_SCALE): number {
  return rateScaled / scale;
}

export function amountToCryptoUnits(amountCents: number, rateScaled: number, rateScale = DEFAULT_RATE_SCALE): number {
  const fiat = amountCents / 100;
  const rate = rateScaled / rateScale;
  return Math.max(1, Math.round((fiat / rate) * CRYPTO_SCALE));
}
