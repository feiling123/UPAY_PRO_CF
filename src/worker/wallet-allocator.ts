import type { AllocateWalletRequest, AllocateWalletResponse } from "../types";
import { amountToCryptoUnits } from "../lib/money";

interface LockRecord {
  tradeId: string;
  token: string;
  actualAmountUnits: number;
  expiresAtMs: number;
}

export class WalletAllocator implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    if (url.pathname === "/allocate") return this.allocate(await request.json<AllocateWalletRequest>());
    if (url.pathname === "/refresh") return this.refresh(await request.json<{ tradeId: string; expiresAtMs: number }>());
    if (url.pathname === "/release") return this.release(await request.json<{ tradeId: string }>());
    if (url.pathname === "/release-many") return this.releaseMany(await request.json<{ tradeIds: string[] }>());
    if (url.pathname === "/sweep") return this.sweep();
    return Response.json({ error: "not found" }, { status: 404 });
  }

  private async allocate(input: AllocateWalletRequest): Promise<Response> {
    if (!input.wallets.length) return Response.json({ error: "no wallets" }, { status: 400 });
    await this.sweepExpired();

    const cursorKey = `cursor:${input.currency}`;
    const cursor = (await this.state.storage.get<number>(cursorKey)) || 0;
    const wallets = rotate(input.wallets, cursor % input.wallets.length);

    for (let slot = 0; slot < input.maxIncrements; slot += 1) {
      for (let index = 0; index < wallets.length; index += 1) {
        const wallet = wallets[index];
        const baseUnits = amountToCryptoUnits(input.amountCents, wallet.rateScaled, wallet.rateScale);
        const actualAmountUnits = baseUnits + slot * input.incrementUnits;
        const key = lockKey(wallet.token, actualAmountUnits);
        const existing = await this.state.storage.get<LockRecord>(key);
        if (existing && existing.expiresAtMs > Date.now()) continue;

        const record: LockRecord = {
          tradeId: input.tradeId,
          token: wallet.token,
          actualAmountUnits,
          expiresAtMs: input.expiresAtMs
        };
        await this.state.storage.put(key, record);
        await this.state.storage.put(`trade:${input.tradeId}`, key);
        await this.state.storage.put(cursorKey, (cursor + index + 1) % input.wallets.length);
        const response: AllocateWalletResponse = {
          token: wallet.token,
          actualAmountUnits,
          walletId: wallet.id,
          rateScaled: wallet.rateScaled
        };
        return Response.json(response);
      }
    }

    return Response.json({ error: "amount slots exhausted" }, { status: 429 });
  }

  private async refresh(input: { tradeId: string; expiresAtMs: number }): Promise<Response> {
    const key = await this.state.storage.get<string>(`trade:${input.tradeId}`);
    if (!key) return Response.json({ ok: false });
    const record = await this.state.storage.get<LockRecord>(key);
    if (!record) return Response.json({ ok: false });
    record.expiresAtMs = input.expiresAtMs;
    await this.state.storage.put(key, record);
    return Response.json({ ok: true });
  }

  private async release(input: { tradeId: string }): Promise<Response> {
    const released = await this.releaseTrade(input.tradeId);
    return Response.json({ ok: released });
  }

  private async releaseMany(input: { tradeIds: string[] }): Promise<Response> {
    let released = 0;
    for (const tradeId of input.tradeIds) {
      if (await this.releaseTrade(tradeId)) released += 1;
    }
    return Response.json({ released });
  }

  private async sweep(): Promise<Response> {
    const released = await this.sweepExpired();
    return Response.json({ released });
  }

  private async releaseTrade(tradeId: string): Promise<boolean> {
    const tradeKey = `trade:${tradeId}`;
    const lock = await this.state.storage.get<string>(tradeKey);
    if (!lock) return false;
    await this.state.storage.delete(lock);
    await this.state.storage.delete(tradeKey);
    return true;
  }

  private async sweepExpired(): Promise<number> {
    const now = Date.now();
    const entries = await this.state.storage.list<LockRecord>({ prefix: "lock:" });
    let released = 0;
    for (const [key, record] of entries) {
      if (record.expiresAtMs <= now) {
        await this.state.storage.delete(key);
        await this.state.storage.delete(`trade:${record.tradeId}`);
        released += 1;
      }
    }
    return released;
  }
}

function lockKey(token: string, actualAmountUnits: number): string {
  return `lock:${token.toLowerCase()}:${actualAmountUnits}`;
}

function rotate<T>(items: T[], offset: number): T[] {
  return [...items.slice(offset), ...items.slice(0, offset)];
}
