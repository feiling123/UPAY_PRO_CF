import type { CallbackMessage, Env, ExpirationMessage, ScanMessage } from "./types";
import { WalletAllocator } from "./worker/wallet-allocator";
import { runEveryMinute, runEveryTenMinutes, expireDue, scanPending } from "./jobs/maintenance";
import { processCallback } from "./jobs/callbacks";
import { Store } from "./lib/store";

export { WalletAllocator };

export default {
  async fetch(): Promise<Response> {
    return Response.json({ ok: true, service: "upay-pro-jobs" });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "*/10 * * * *") {
      ctx.waitUntil(runEveryTenMinutes(env));
      return;
    }
    ctx.waitUntil(runEveryMinute(env));
  },

  async queue(batch: MessageBatch<ScanMessage | ExpirationMessage | CallbackMessage>, env: Env): Promise<void> {
    const store = new Store(env);
    for (const message of batch.messages) {
      try {
        if (message.body.kind === "callback") {
          await processCallback(env, message.body.tradeId, message.body.attempt || 0);
        } else if (message.body.kind === "expire") {
          const order = await store.orderByTradeId(message.body.tradeId);
          if (order && order.status === 1 && order.expiration_time_ms <= Date.now()) {
            await store.markExpired(order.trade_id);
            const id = env.WALLET_ALLOCATOR.idFromName(`${order.merchant_id || "default"}:${order.currency}`);
            await env.WALLET_ALLOCATOR.get(id).fetch("https://wallet-allocator/release", {
              method: "POST",
              body: JSON.stringify({ tradeId: order.trade_id })
            });
          }
        } else if (message.body.kind === "scan") {
          await scanPending(env, store);
          if (message.body.tradeId) await rescheduleScanIfPending(env, store, message.body.tradeId);
        }
        message.ack();
      } catch (error) {
        message.retry({ delaySeconds: 60 });
      }
    }
    await expireDue(env, store);
  }
};

async function rescheduleScanIfPending(env: Env, store: Store, tradeId: string): Promise<void> {
  const order = await store.orderByTradeId(tradeId);
  if (!order || order.status !== 1) return;
  const now = Date.now();
  if (order.expiration_time_ms <= now) return;
  const nextAt = order.next_scan_at_ms || now + 30_000;
  const delaySeconds = Math.max(5, Math.min(30, Math.ceil((Math.min(nextAt, order.expiration_time_ms) - now) / 1000)));
  await env.ORDER_SCAN_QUEUE?.send({ kind: "scan", reason: "retry", tradeId }, { delaySeconds });
}
