import type { Env, OrderRow } from "../types";
import { Store } from "../lib/store";
import { getCurrency } from "../lib/currencies";
import { scanWalletTransfers } from "../chains/providers";
import { seconds } from "../lib/time";
import { fetchOkxRateScaled } from "../chains/rates";

export async function runEveryMinute(env: Env): Promise<void> {
  const store = new Store(env);
  await expireDue(env, store);
  await scanPending(env, store);
  await enqueueDueCallbacks(env, store);
}

export async function runEveryTenMinutes(env: Env): Promise<void> {
  const store = new Store(env);
  const wallets = await store.listWallets();
  const symbols = new Set<"USDT" | "USDC" | "TRX">();
  for (const wallet of wallets) {
    if (!wallet.auto_rate) continue;
    const spec = getCurrency(wallet.currency);
    if (spec) symbols.add(spec.symbol);
  }
  for (const symbol of symbols) {
    const rate = await fetchOkxRateScaled(symbol);
    if (rate) {
      await store.setRate(symbol, rate, "okx");
      await store.updateAutoRateWallets(symbol, rate);
    }
  }
}

export async function expireDue(env: Env, store = new Store(env)): Promise<void> {
  const expired = await store.expireDueOrders(200);
  await releaseLocks(env, expired);
}

export async function scanPending(env: Env, store = new Store(env)): Promise<void> {
  const limit = seconds(env.CRON_SCAN_ORDER_LIMIT, 100);
  const groupLimit = seconds(env.CRON_SCAN_GROUP_LIMIT, 20);
  const orders = await store.pendingOrdersForScan(limit);
  const groups = groupOrders(orders).slice(0, groupLimit);
  for (const group of groups) {
    await scanGroup(env, store, group);
  }
}

async function scanGroup(env: Env, store: Store, group: OrderGroup): Promise<void> {
  const minStart = Math.min(...group.orders.map((order) => order.start_time_ms)) - 180_000;
  const maxEnd = Math.max(...group.orders.map((order) => order.expiration_time_ms));
  const transfers = await scanWalletTransfers(env, group.currency, group.token, minStart, maxEnd);
  if (!transfers.length) {
    await Promise.all(group.orders.map((order) => store.scheduleNextScan(order.trade_id, nextScanDelay(order.scan_attempts))));
    return;
  }

  const ordersByAmount = new Map<number, OrderRow[]>();
  for (const order of group.orders) {
    const list = ordersByAmount.get(order.actual_amount_units) || [];
    list.push(order);
    ordersByAmount.set(order.actual_amount_units, list);
  }

  const paid: OrderRow[] = [];
  for (const transfer of transfers) {
    if (!sameAddress(transfer.to, group.token)) continue;
    const candidates = ordersByAmount.get(transfer.amountUnits) || [];
    for (const order of candidates) {
      if (transfer.timestampMs < order.start_time_ms || transfer.timestampMs > order.expiration_time_ms) continue;
      const updated = await store.markOrderPaid(order.trade_id, transfer.txId);
      if (updated) {
        paid.push(order);
        await store.enqueueCallback(order.trade_id);
        await env.CALLBACK_QUEUE?.send({ kind: "callback", tradeId: order.trade_id, attempt: 0 });
      }
      break;
    }
  }

  await releaseLocks(env, paid);
  const paidSet = new Set(paid.map((order) => order.trade_id));
  await Promise.all(
    group.orders
      .filter((order) => !paidSet.has(order.trade_id))
      .map((order) => store.scheduleNextScan(order.trade_id, nextScanDelay(order.scan_attempts)))
  );
}

export async function enqueueDueCallbacks(env: Env, store = new Store(env)): Promise<void> {
  const due = await store.dueCallbacks(50);
  for (const item of due) {
    await env.CALLBACK_QUEUE?.send({ kind: "callback", tradeId: item.trade_id, attempt: item.attempt });
  }
}

async function releaseLocks(env: Env, orders: OrderRow[]): Promise<void> {
  const byScope = new Map<string, { merchantId: string; currency: string; tradeIds: string[] }>();
  for (const order of orders) {
    const merchantId = order.merchant_id || "default";
    const key = `${merchantId}:${order.currency}`;
    const item = byScope.get(key) || { merchantId, currency: order.currency, tradeIds: [] };
    item.tradeIds.push(order.trade_id);
    byScope.set(key, item);
  }
  for (const item of byScope.values()) {
    const id = env.WALLET_ALLOCATOR.idFromName(`${item.merchantId}:${item.currency}`);
    const stub = env.WALLET_ALLOCATOR.get(id);
    await stub.fetch("https://wallet-allocator/release-many", {
      method: "POST",
      body: JSON.stringify({ tradeIds: item.tradeIds })
    });
  }
}

interface OrderGroup {
  currency: string;
  merchantId: string;
  token: string;
  orders: OrderRow[];
}

function groupOrders(orders: OrderRow[]): OrderGroup[] {
  const map = new Map<string, OrderGroup>();
  for (const order of orders) {
    const merchantId = order.merchant_id || "default";
    const key = `${merchantId}:${order.currency}:${order.token.toLowerCase()}`;
    const group = map.get(key) || { merchantId, currency: order.currency, token: order.token, orders: [] };
    group.orders.push(order);
    map.set(key, group);
  }
  return [...map.values()];
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function nextScanDelay(attempts: number): number {
  return attempts === 0 ? 15_000 : 30_000;
}
