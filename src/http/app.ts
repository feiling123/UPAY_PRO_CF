import { Hono } from "hono";
import type { Env } from "../types";
import { createSession, clearSessionCookie, optionalAdminSession, requireAdmin, securityHeaders, setSessionCookie, type SessionClaims } from "../lib/auth";
import { Store } from "../lib/store";
import { hashPassword, verifyPassword } from "../lib/password";
import { clientIp, jsonMessage, jsonOk, readJsonLimited } from "../lib/http";
import { verifyTurnstile } from "../lib/turnstile";
import { looksLikeProbe, throttleLocal } from "../lib/security";
import { adminPublicPath } from "../lib/admin-path";
import { createOrderSchema, hashViewToken, signViewToken, verifyCreateOrderSignature, verifyViewToken, verifyViewTokenSignature } from "../lib/signing";
import { getCurrency, listCurrencyCodes } from "../lib/currencies";
import { centsToDecimal, DEFAULT_INCREMENT_UNITS, parseAmountCents, rateToScaled, unitsToToken } from "../lib/money";
import { nowMs, seconds } from "../lib/time";
import { randomId, tradeId } from "../lib/crypto";
import { ConfigError, isStrongSecret, secretPolicyMessage } from "../lib/secrets";
import { ensureSchema } from "../lib/schema";
import { serializeMerchant, serializeOrder, serializeSettings, serializeUser, serializeWallet } from "./serializers";

type AppEnv = { Bindings: Env; Variables: { session?: SessionClaims } };
export const app = new Hono<AppEnv>();

app.onError((error, c) => {
  if (error instanceof ConfigError) {
    return jsonMessage(c, `服务配置错误：${error.message}`, 500);
  }
  if (String(error.message || error).includes("no such table")) {
    return jsonMessage(c, "D1 数据库未初始化，请先执行 D1 migrations", 500);
  }
  return jsonMessage(c, "服务内部错误，请查看 Worker 日志", 500);
});

app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (looksLikeProbe(path)) return new Response("Not found", { status: 404 });
  await next();
  for (const [key, value] of Object.entries(securityHeaders())) c.header(key, value);
  return undefined;
});

app.get("/api/health", async (c) => {
  try {
    await ensureSchema(c.env);
    return c.json({ ok: true, service: "upay-pro-cloudflare", database: true, time: new Date().toISOString() });
  } catch {
    return c.json({ ok: false, service: "upay-pro-cloudflare", database: false, message: "D1 migrations not applied", time: new Date().toISOString() }, 500);
  }
});
app.get("/api/meta", (c) => c.json({ currencies: listCurrencyCodes(), turnstile_site_key: c.env.TURNSTILE_SITE_KEY || "" }));

app.get("/admin", async (c) => serveAdminEntry(c));
app.get("/admin/", async (c) => serveAdminEntry(c));
app.get("/admin.html", requireAdmin, async (c) => serveAsset(c, "/admin.html"));

app.post("/login", async (c) => {
  const parsedBody = await readJsonLimited<{ username?: string; password?: string; turnstile_token?: string }>(c, 1024);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.data;
  if (!body?.username || !body.password) return jsonMessage(c, "用户名或密码错误", 400);

  const ip = clientIp(c);
  const turnstileOk = await verifyTurnstile(c.env, body.turnstile_token, ip);
  if (!turnstileOk) return jsonMessage(c, "人机验证失败", 403);

  await ensureSchema(c.env);
  const store = new Store(c.env);
  const user = await store.userByUsername(body.username);
  if (!user || !(await verifyPassword(body.password, user.password_hash))) return jsonMessage(c, "用户名或密码错误", 400);
  const token = await createSession(c.env, { sub: String(user.id), username: user.username, role: user.role });
  setSessionCookie(c, token);
  return c.json({ code: 0, message: "登录成功", redirect: adminPublicPath(c.env) || "/" });
});

app.post("/admin/logout", requireAdmin, (c) => {
  clearSessionCookie(c);
  return c.json({ code: 0, message: "退出成功" });
});

app.get("/admin/api/stats", requireAdmin, async (c) => {
  return jsonOk(c, await new Store(c.env).stats());
});

app.get("/admin/api/users", requireAdmin, async (c) => {
  const users = await new Store(c.env).listUsers();
  return jsonOk(c, users.map(serializeUser));
});

app.post("/admin/api/users/password", requireAdmin, async (c) => {
  const body = await c.req.json<{ userId?: number; newPassword?: string }>().catch(() => null);
  if (!body?.userId || !body.newPassword || body.newPassword.length < 6) return jsonMessage(c, "参数错误", 400);
  const ok = await new Store(c.env).updatePassword(body.userId, await hashPassword(body.newPassword));
  return ok ? c.json({ code: 0, message: "密码修改成功" }) : jsonMessage(c, "用户不存在", 404);
});

app.get("/admin/api/orders", requireAdmin, async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const limit = Math.max(1, Math.min(100, Number(c.req.query("limit") || 10)));
  const search = (c.req.query("search") || "").slice(0, 128);
  const result = await new Store(c.env).listOrders(page, limit, search);
  return jsonOk(c, {
    orders: result.orders.map(serializeOrder),
    total: result.total,
    page,
    limit
  });
});

app.get("/admin/api/wallets", requireAdmin, async (c) => {
  const wallets = await new Store(c.env).listWallets();
  return jsonOk(c, wallets.map(serializeWallet));
});

app.get("/admin/api/merchants", requireAdmin, async (c) => {
  const store = new Store(c.env);
  const merchants = await store.listMerchants();
  const rows = [];
  for (const merchant of merchants) {
    rows.push(serializeMerchant(merchant, await store.getMerchantSecret(merchant.merchant_id)));
  }
  return jsonOk(c, rows);
});

app.post("/admin/api/merchants", requireAdmin, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return jsonMessage(c, "参数错误", 400);
  const merchantId = merchantIdValue(body.merchant_id || body.MerchantId, "");
  const name = String(body.name || body.Name || merchantId);
  const signingSecret = String(body.signing_secret || body.SigningSecret || randomId("msec_"));
  if (!merchantId || !name || !isStrongSecret(signingSecret)) return jsonMessage(c, secretPolicyMessage("商户签名密钥"), 400);
  try {
    const store = new Store(c.env);
    const merchant = await store.createMerchant({ merchant_id: merchantId, name, signing_secret: signingSecret, status: Number(body.status || 1) });
    return c.json({ code: 0, message: "创建成功", data: { ...serializeMerchant(merchant, signingSecret), SigningSecretPlain: signingSecret } });
  } catch {
    return jsonMessage(c, "商户已存在", 400);
  }
});

app.put("/admin/api/merchants/:merchant_id", requireAdmin, async (c) => {
  const merchantId = merchantIdValue(c.req.param("merchant_id"), "");
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!merchantId || !body) return jsonMessage(c, "参数错误", 400);
  const signingSecret = stringValue(body.signing_secret || body.SigningSecret);
  if (signingSecret && !isStrongSecret(signingSecret)) return jsonMessage(c, secretPolicyMessage("商户签名密钥"), 400);
  const ok = await new Store(c.env).updateMerchant(merchantId, {
    name: stringValue(body.name || body.Name),
    status: intValue(body.status || body.Status),
    signing_secret: signingSecret
  });
  return ok ? c.json({ code: 0, message: "保存成功" }) : jsonMessage(c, "商户不存在", 404);
});

app.post("/admin/api/wallets", requireAdmin, async (c) => {
  const input = await walletInput(c);
  if ("error" in input) return jsonMessage(c, input.error, 400);
  const merchant = await new Store(c.env).merchantById(input.value.merchant_id);
  if (!merchant || merchant.status !== 1) return jsonMessage(c, "商户不存在或已禁用", 400);
  try {
    const wallet = await new Store(c.env).createWallet(input.value);
    return c.json({ code: 0, message: "添加成功", data: serializeWallet(wallet) });
  } catch (error) {
    return jsonMessage(c, "钱包地址在当前币种中已存在", 400);
  }
});

app.put("/admin/api/wallets/:id", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const input = await walletInput(c);
  if (!Number.isInteger(id) || "error" in input) return jsonMessage(c, "参数错误", 400);
  const store = new Store(c.env);
  const merchant = await store.merchantById(input.value.merchant_id);
  if (!merchant || merchant.status !== 1) return jsonMessage(c, "商户不存在或已禁用", 400);
  const ok = await store.updateWallet(id, input.value);
  return ok ? c.json({ code: 0, message: "更新成功" }) : jsonMessage(c, "钱包地址更新失败", 404);
});

app.delete("/admin/api/wallets/:id", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return jsonMessage(c, "参数错误", 400);
  const ok = await new Store(c.env).deleteWallet(id);
  return ok ? c.json({ code: 0, message: "删除成功" }) : jsonMessage(c, "钱包地址不存在", 404);
});

app.get("/admin/api/settings", requireAdmin, async (c) => {
  const store = new Store(c.env);
  const settings = await store.settings();
  const secure = {
    merchant_signing_secret: await store.getSecure("merchant_signing_secret", c.env.MERCHANT_SIGNING_SECRET),
    telegram_bot_token: await store.getSecure("telegram_bot_token", c.env.TELEGRAM_BOT_TOKEN),
    telegram_chat_id: await store.getSecure("telegram_chat_id", c.env.TELEGRAM_CHAT_ID),
    bark_key: await store.getSecure("bark_key", c.env.BARK_KEY)
  };
  return jsonOk(c, serializeSettings(settings, secure));
});

app.post("/admin/api/settings", requireAdmin, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return jsonMessage(c, "参数错误", 400);
  const store = new Store(c.env);
  await store.updateSettings({
    app_url: stringValue(body.appurl),
    app_name: stringValue(body.appname),
    customer_service_contact: stringValue(body.customerservicecontact),
    order_expiration_seconds: intValue(body.expirationdate),
    pay_status_min_interval_seconds: intValue(body.pay_status_min_interval_seconds),
    callback_max_attempts: intValue(body.callback_max_attempts),
    scan_order_limit: intValue(body.scan_order_limit),
    scan_group_limit: intValue(body.scan_group_limit),
    free_tier_mode: boolInt(body.free_tier_mode),
    turnstile_required: boolInt(body.turnstile_required)
  });
  if (typeof body.secretkey === "string" && body.secretkey && !body.secretkey.includes("****") && !isStrongSecret(body.secretkey)) {
    return jsonMessage(c, secretPolicyMessage("默认商户签名密钥"), 400);
  }
  await maybeSetMerchantSecret(store, body.secretkey);
  await maybeSetSecure(store, "telegram_bot_token", body.tgbotkey);
  await maybeSetSecure(store, "telegram_chat_id", body.tgchatid);
  await maybeSetSecure(store, "bark_key", body.barkkey);
  return c.json({ code: 0, message: "保存成功" });
});

app.get("/admin/api/apikeys", requireAdmin, async (c) => {
  const store = new Store(c.env);
  return jsonOk(c, {
    Tronscan: mask(await store.getSecure("tronscan_api_key", c.env.TRONSCAN_API_KEY)),
    Trongrid: mask(await store.getSecure("trongrid_api_key", c.env.TRONGRID_API_KEY)),
    Etherscan: mask(await store.getSecure("etherscan_api_key", c.env.ETHERSCAN_API_KEY))
  });
});

app.post("/admin/api/apikeys", requireAdmin, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return jsonMessage(c, "参数错误", 400);
  const store = new Store(c.env);
  await maybeSetSecure(store, "tronscan_api_key", body.tronscan);
  await maybeSetSecure(store, "trongrid_api_key", body.trongrid);
  await maybeSetSecure(store, "etherscan_api_key", body.etherscan);
  return c.json({ code: 0, message: "保存成功" });
});

app.post("/admin/api/manual-complete-order", requireAdmin, async (c) => {
  const body = await c.req.json<{ order_id?: string }>().catch(() => null);
  if (!body?.order_id) return jsonMessage(c, "参数错误", 400);
  const store = new Store(c.env);
  let order = await store.orderByTradeId(body.order_id);
  if (!order) order = await store.latestByAnyMerchantOrderId(body.order_id);
  if (!order) return jsonMessage(c, "订单不存在", 404);
  const ok = order.status === 2 || await store.forceOrderPaid(order.trade_id, `manual:${order.trade_id}`);
  if (ok) {
    await releaseWalletLock(c.env, order.merchant_id || "default", order.currency, order.trade_id);
    await store.enqueueCallback(order.trade_id);
    await c.env.CALLBACK_QUEUE?.send({ kind: "callback", tradeId: order.trade_id, attempt: 0 });
  }
  return c.json({ code: 0, message: "订单已手动完成" });
});

app.post("/admin/api/test-orders", requireAdmin, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return jsonMessage(c, "参数错误", 400);
  const origin = new URL(c.req.url).origin;
  const merchantId = merchantIdValue(body.merchant_id || body.MerchantId);
  if (!merchantId) return jsonMessage(c, "商户ID格式错误", 400);
  const input = {
    type: String(body.type || body.Type || ""),
    order_id: String(body.order_id || body.OrderId || `test_${tradeId()}`),
    amount: Number(body.amount || body.Amount),
    notify_url: String(body.notify_url || body.NotifyUrl || `${origin}/api/test-notify`),
    redirect_url: String(body.redirect_url || body.RedirectUrl || `${origin}${adminPublicPath(c.env) || "/"}`),
    signature: "admin-test-order",
    merchant_id: merchantId
  };
  return createOrderUnchecked(c, input);
});

app.post("/api/test-notify", async (c) => c.text("success"));

async function serveAdminEntry(c: import("hono").Context<AppEnv>): Promise<Response> {
  const session = await optionalAdminSession(c);
  return serveAsset(c, session ? "/admin.html" : "/login.html");
}

function serveAsset(c: import("hono").Context<AppEnv>, pathname: string): Response | Promise<Response> {
  if (!c.env.ASSETS) return new Response("Not found", { status: 404 });
  const url = new URL(c.req.url);
  url.pathname = pathname;
  url.search = "";
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
}

app.post("/api/create_order", async (c) => {
  const parsedBody = await readJsonLimited(c, 4096);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = createOrderSchema.safeParse(parsedBody.data);
  if (!parsed.success) return jsonMessage(c, "参数错误", 400);
  const input = parsed.data;
  const merchantId = merchantIdValue(input.merchant_id);
  if (!merchantId) return jsonMessage(c, "商户ID格式错误", 400);
  const currency = getCurrency(input.type);
  if (!currency) return jsonMessage(c, "不支持的货币类型", 400);
  const urlError = validateMerchantUrls(input.notify_url, input.redirect_url, false);
  if (urlError) return jsonMessage(c, urlError, 400);
  const amountCents = parseAmountCents(input.amount);
  if (!amountCents || amountCents > 5_000_000) return jsonMessage(c, "金额超出范围", 400);

  const store = new Store(c.env);
  const merchant = await store.merchantById(merchantId);
  if (!merchant || merchant.status !== 1) return jsonMessage(c, "商户不存在或已禁用", 401);
  const merchantSecret = await store.getMerchantSecret(merchantId);
  if (!merchantSecret) return jsonMessage(c, "商户密钥未配置", 500);
  const signatureVersion = c.req.header("x-upay-signature-version") ?? null;
  if (signatureVersion !== "v2" && c.env.LEGACY_MD5_ENABLED === "false") return jsonMessage(c, "旧版 MD5 签名已禁用", 401);
  const signatureOk = await verifyCreateOrderSignature(input, merchantSecret, signatureVersion);
  if (!signatureOk) return jsonMessage(c, "签名验证失败", 401);

  return createOrderUnchecked(c, { ...input, merchant_id: merchantId });
});

async function createOrderUnchecked(c: import("hono").Context<AppEnv>, input: {
  merchant_id?: string;
  type: string;
  order_id: string;
  amount: number;
  notify_url: string;
  redirect_url: string;
  signature: string;
}): Promise<Response> {
  const merchantId = merchantIdValue(input.merchant_id);
  if (!merchantId) return jsonMessage(c, "商户ID格式错误", 400);
  const currency = getCurrency(input.type);
  if (!currency) return jsonMessage(c, "不支持的货币类型", 400);
  const urlError = validateMerchantUrls(input.notify_url, input.redirect_url, true);
  if (urlError) return jsonMessage(c, urlError, 400);
  const amountCents = parseAmountCents(input.amount);
  if (!amountCents || amountCents > 5_000_000) return jsonMessage(c, "金额超出范围", 400);
  const store = new Store(c.env);
  const merchant = await store.merchantById(merchantId);
  if (!merchant || merchant.status !== 1) return jsonMessage(c, "商户不存在或已禁用", 400);
  const settings = await store.settings();
  const ttlSeconds = settings.order_expiration_seconds || seconds(c.env.ORDER_EXPIRATION_SECONDS, 300);
  const existing = await store.latestPendingByOrderId(input.order_id, merchantId);
  if (existing) {
    const expiresAtMs = nowMs() + ttlSeconds * 1000;
    await store.refreshPendingOrder(existing, expiresAtMs);
    await refreshWalletLock(c.env, existing.merchant_id, existing.currency, existing.trade_id, expiresAtMs);
    const token = await signViewToken(c.env, existing.trade_id, expiresAtMs);
    return c.json(orderCreateResponse(c.env, existing, token, expiresAtMs));
  }
  const previous = await store.latestByOrderId(input.order_id, merchantId);
  if (previous?.status === 2) {
    return c.json({
      status_code: 409,
      message: "order already paid",
      data: {
        trade_id: previous.trade_id,
        merchant_id: previous.merchant_id || "default",
        order_id: previous.order_id,
        status: previous.status
      }
    }, 409);
  }

  const wallets = await store.enabledWallets(merchantId, input.type);
  if (!wallets.length) return jsonMessage(c, "请先添加钱包地址", 400);

  const newTradeId = tradeId();
  const expiresAtMs = nowMs() + ttlSeconds * 1000;
  const allocation = await allocateWallet(c.env, merchantId, input.type, amountCents, newTradeId, expiresAtMs, wallets);
  if (!allocation.ok) return jsonMessage(c, allocation.message, 429);

  const viewToken = await signViewToken(c.env, newTradeId, expiresAtMs);
  try {
    const order = await store.createOrder({
      merchant_id: merchantId,
      trade_id: newTradeId,
      order_id: input.order_id,
      amount_cents: amountCents,
      actual_amount_units: allocation.data.actualAmountUnits,
      actual_amount_scale: 1_000_000,
      currency: input.type,
      token: allocation.data.token,
      status: 1,
      notify_url: input.notify_url,
      redirect_url: input.redirect_url,
      next_scan_at_ms: nowMs() + 15_000,
      view_token_hash: hashViewToken(viewToken),
      start_time_ms: nowMs(),
      expiration_time_ms: expiresAtMs
    });
    await c.env.ORDER_EXPIRATION_QUEUE?.send({ kind: "expire", tradeId: order.trade_id }, { delaySeconds: ttlSeconds });
    await c.env.ORDER_SCAN_QUEUE?.send({ kind: "scan", reason: "created", tradeId: order.trade_id }, { delaySeconds: 15 });
    return c.json(orderCreateResponse(c.env, order, viewToken, expiresAtMs));
  } catch (error) {
    await releaseWalletLock(c.env, merchantId, input.type, newTradeId);
    throw error;
  }
}

app.get("/api/public/orders/:trade_id", async (c) => publicOrderImpl(c));
app.get("/pay/check-status/:trade_id", async (c) => publicStatus(c));
app.get("/pay/checkout-counter/:trade_id", async (c) => c.redirect(`/pay.html?trade_id=${encodeURIComponent(c.req.param("trade_id"))}&pv=${encodeURIComponent(c.req.query("pv") || "")}`));

async function publicStatus(c: import("hono").Context<AppEnv>): Promise<Response> {
  const tradeId = c.req.param("trade_id") || "";
  const pv = c.req.query("pv") ?? null;
  if (!(await verifyViewTokenSignature(c.env, tradeId, pv))) return new Response("Not found", { status: 404 });
  const store = new Store(c.env);
  const order = await store.orderByTradeId(tradeId);
  if (!order || !(await verifyViewToken(c.env, tradeId, pv, order.view_token_hash))) return new Response("Not found", { status: 404 });
  const settings = await store.settings();
  const minInterval = (settings.pay_status_min_interval_seconds || 8) * 1000;
  const key = `status:${tradeId}:${pv}`;
  const throttle = throttleLocal(key, minInterval);
  if (!throttle.ok) {
    return c.json({ data: { status: order.status }, next_poll_after_ms: throttle.retryAfterMs }, 429, { "Retry-After": String(Math.ceil(throttle.retryAfterMs / 1000)) });
  }
  return c.json({
    data: { status: order.status },
    message: "1-待支付，2-支付成功，3-支付过期",
    next_poll_after_ms: minInterval,
    redirect_url: order.redirect_url
  });
}

async function publicOrderImpl(c: import("hono").Context<AppEnv>): Promise<Response> {
  const tradeId = c.req.param("trade_id") || "";
  const pv = c.req.query("pv") ?? null;
  if (!(await verifyViewTokenSignature(c.env, tradeId, pv))) return new Response("Not found", { status: 404 });
  const store = new Store(c.env);
  const order = await store.orderByTradeId(tradeId);
  if (!order || !(await verifyViewToken(c.env, tradeId, pv, order.view_token_hash))) return new Response("Not found", { status: 404 });
  const settings = await store.settings();
  const spec = getCurrency(order.currency);
  return jsonOk(c, {
    trade_id: order.trade_id,
    merchant_id: order.merchant_id || "default",
    order_id: order.order_id,
    amount: centsToDecimal(order.amount_cents),
    actual_amount: unitsToToken(order.actual_amount_units, order.actual_amount_scale),
    currency: order.currency,
    token: order.token,
    status: order.status,
    expiration_time: order.expiration_time_ms,
    redirect_url: order.redirect_url,
    app_name: settings.app_name || c.env.APP_NAME || "UPay Pro",
    customer_service_contact: settings.customer_service_contact,
    logo: spec?.logo || ""
  }, { headers: { "Cache-Control": "private, max-age=15" } });
}

async function walletInput(c: import("hono").Context<AppEnv>): Promise<{ value: any } | { error: string }> {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return { error: "参数错误" };
  const currency = String(body.currency || body.Currency || "");
  const token = String(body.token || body.Token || "");
  const rate = rateToScaled(body.rate ?? body.Rate);
  if (!getCurrency(currency) || !token || !rate) return { error: "币种、钱包地址或汇率错误" };
  return {
    value: {
      currency,
      merchant_id: merchantIdValue(body.merchant_id || body.MerchantId) || "",
      token,
      status: Number(body.status ?? body.Status ?? 1),
      rate_scaled: rate,
      rate_scale: 1_000_000,
      auto_rate: body.AutoRate === true || body.auto_rate === true ? 1 : 0
    }
  };
}

async function allocateWallet(env: Env, merchantId: string, currency: string, amountCents: number, tradeId: string, expiresAtMs: number, wallets: Array<{ id: number; token: string; rate_scaled: number; rate_scale: number }>) {
  const id = env.WALLET_ALLOCATOR.idFromName(`${merchantId}:${currency}`);
  const response = await env.WALLET_ALLOCATOR.get(id).fetch("https://wallet-allocator/allocate", {
    method: "POST",
    body: JSON.stringify({
      currency,
      amountCents,
      tradeId,
      expiresAtMs,
      maxIncrements: 200,
      incrementUnits: DEFAULT_INCREMENT_UNITS,
      wallets: wallets.map((wallet) => ({
        id: wallet.id,
        token: wallet.token,
        rateScaled: wallet.rate_scaled,
        rateScale: wallet.rate_scale
      }))
    })
  });
  if (!response.ok) return { ok: false as const, message: "金额槽位已满，请稍后再试" };
  return { ok: true as const, data: await response.json<{ token: string; actualAmountUnits: number; walletId: number; rateScaled: number }>() };
}

async function refreshWalletLock(env: Env, merchantId: string, currency: string, tradeId: string, expiresAtMs: number): Promise<void> {
  const id = env.WALLET_ALLOCATOR.idFromName(`${merchantId}:${currency}`);
  await env.WALLET_ALLOCATOR.get(id).fetch("https://wallet-allocator/refresh", { method: "POST", body: JSON.stringify({ tradeId, expiresAtMs }) });
}

async function releaseWalletLock(env: Env, merchantId: string, currency: string, tradeId: string): Promise<void> {
  const id = env.WALLET_ALLOCATOR.idFromName(`${merchantId}:${currency}`);
  await env.WALLET_ALLOCATOR.get(id).fetch("https://wallet-allocator/release", { method: "POST", body: JSON.stringify({ tradeId }) });
}

function orderCreateResponse(env: Env, order: { merchant_id?: string; trade_id: string; order_id: string; amount_cents: number; actual_amount_units: number; actual_amount_scale: number; token: string }, viewToken: string, expiresAtMs: number): Record<string, unknown> {
  const appUrl = env.APP_URL || "";
  return {
    status_code: 200,
    message: "success",
    data: {
      trade_id: order.trade_id,
      merchant_id: order.merchant_id || "default",
      order_id: order.order_id,
      amount: centsToDecimal(order.amount_cents),
      actual_amount: unitsToToken(order.actual_amount_units, order.actual_amount_scale),
      token: order.token,
      expiration_time: expiresAtMs,
      payment_url: `${appUrl}/pay/checkout-counter/${order.trade_id}?pv=${encodeURIComponent(viewToken)}`
    }
  };
}

function merchantIdValue(value: unknown, fallback = "default"): string | null {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return /^[A-Za-z0-9_-]{3,64}$/.test(text) ? text : null;
}

function validateMerchantUrls(notifyUrl: string, redirectUrl: string, allowLocalDev: boolean): string | null {
  if (!isSafeHttpUrl(notifyUrl, allowLocalDev)) return "notify_url 必须是安全的 HTTP(S) URL";
  if (!isSafeHttpUrl(redirectUrl, allowLocalDev)) return "redirect_url 必须是安全的 HTTP(S) URL";
  return null;
}

function isSafeHttpUrl(value: string, allowLocalDev: boolean): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = normalizeHost(url.hostname);
  if (url.username || url.password) return false;
  if (url.protocol === "http:" && !(allowLocalDev && isLocalhost(host))) return false;
  if (isLocalhost(host) || isPrivateHost(host)) return allowLocalDev;
  return true;
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function isLocalhost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

function isPrivateHost(host: string): boolean {
  if (host.includes(":")) {
    return host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  }
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" && !value.includes("****") ? value : undefined;
}

function intValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function boolInt(value: unknown): 0 | 1 | undefined {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === "true" || value === "1") return 1;
  if (value === "false" || value === "0") return 0;
  return undefined;
}

async function maybeSetSecure(store: Store, key: string, value: unknown): Promise<void> {
  if (typeof value === "string" && value && !value.includes("****")) await store.setSecure(key, value);
}

async function maybeSetMerchantSecret(store: Store, value: unknown): Promise<void> {
  if (typeof value === "string" && value && !value.includes("****")) await store.setMerchantSecret("default", value);
}

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}********${value.slice(-4)}`;
}
