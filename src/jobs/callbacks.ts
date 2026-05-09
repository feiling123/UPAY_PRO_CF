import type { Env, OrderRow } from "../types";
import { Store } from "../lib/store";
import { centsToDecimal, unitsToToken } from "../lib/money";
import { signLegacyCallback } from "../lib/signing";
import { seconds } from "../lib/time";

export async function processCallback(env: Env, tradeId: string, attempt = 0): Promise<void> {
  const store = new Store(env);
  const order = await store.orderByTradeId(tradeId);
  if (!order || order.status !== 2 || order.callback_confirm === 1) return;
  if (!(await store.claimCallback(tradeId))) return;
  const secret = await store.getMerchantSecret(order.merchant_id || "default");
  if (!secret) {
    await store.incrementCallbackFailure(tradeId, "merchant signing secret is not configured", Date.now() + 600_000, true);
    return;
  }

  const payload = buildCallbackPayload(order, secret);
  try {
    const response = await fetch(order.notify_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    });
    const body = (await response.text()).trim();
    if (response.status === 200 && (body === "ok" || body === "success")) {
      await store.markCallbackConfirmed(tradeId);
      await sendNotifications(env, store, order);
      return;
    }
    throw new Error(`callback returned ${response.status}: ${body.slice(0, 120)}`);
  } catch (error) {
    const settings = await store.settings();
    const maxAttempts = settings.callback_max_attempts || seconds(env.CALLBACK_MAX_ATTEMPTS, 5);
    const nextAttempt = attempt + 1;
    const failed = nextAttempt >= maxAttempts;
    const delay = callbackBackoffMs(nextAttempt);
    await store.incrementCallbackFailure(tradeId, error instanceof Error ? error.message : String(error), Date.now() + delay, failed);
    if (!failed) await env.CALLBACK_QUEUE?.send({ kind: "callback", tradeId, attempt: nextAttempt }, { delaySeconds: Math.ceil(delay / 1000) });
  }
}

function buildCallbackPayload(order: OrderRow, secret: string): Record<string, string | number> {
  const payload = {
    trade_id: order.trade_id,
    order_id: order.order_id,
    amount: centsToDecimal(order.amount_cents),
    actual_amount: unitsToToken(order.actual_amount_units, order.actual_amount_scale),
    token: order.token,
    block_transaction_id: order.block_transaction_id || "0",
    status: order.status
  };
  return {
    ...payload,
    signature: signLegacyCallback(payload, secret)
  };
}

async function sendNotifications(env: Env, store: Store, order: OrderRow): Promise<void> {
  const message = `UPay Pro 订单支付成功\n订单号: ${order.trade_id}\n币种: ${order.currency}\n金额: ${unitsToToken(order.actual_amount_units, order.actual_amount_scale)}\nTx: ${order.block_transaction_id || "0"}`;
  const telegramBotToken = await store.getSecure("telegram_bot_token", env.TELEGRAM_BOT_TOKEN);
  const telegramChatId = await store.getSecure("telegram_chat_id", env.TELEGRAM_CHAT_ID);
  const barkKey = await store.getSecure("bark_key", env.BARK_KEY);
  if (telegramBotToken && telegramChatId) {
    await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramChatId, text: message })
    }).catch(() => undefined);
  }
  if (barkKey) {
    await fetch(`https://api.day.app/${barkKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "UPay Pro 订单通知", body: message })
    }).catch(() => undefined);
  }
}

function callbackBackoffMs(attempt: number): number {
  const sequence = [30_000, 120_000, 300_000, 600_000, 1_800_000];
  return sequence[Math.min(attempt, sequence.length) - 1] || 1_800_000;
}
