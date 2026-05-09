import type { MerchantRow, OrderRow, SettingsRow, UserRow, WalletRow } from "../types";
import { centsToDecimal, scaledToRate, unitsToToken } from "../lib/money";

export function serializeUser(user: UserRow): Record<string, unknown> {
  return {
    ID: user.id,
    UserName: user.username,
    Role: user.role,
    CreatedAt: user.created_at_ms,
    UpdatedAt: user.updated_at_ms
  };
}

export function serializeWallet(wallet: WalletRow): Record<string, unknown> {
  return {
    ID: wallet.id,
    MerchantId: wallet.merchant_id,
    Currency: wallet.currency,
    Token: wallet.token,
    Status: wallet.status,
    Rate: scaledToRate(wallet.rate_scaled, wallet.rate_scale),
    AutoRate: wallet.auto_rate === 1,
    CreatedAt: wallet.created_at_ms,
    UpdatedAt: wallet.updated_at_ms
  };
}

export function serializeMerchant(merchant: MerchantRow, secret: string): Record<string, unknown> {
  return {
    ID: merchant.id,
    MerchantId: merchant.merchant_id,
    Name: merchant.name,
    Status: merchant.status,
    SigningSecret: mask(secret),
    CreatedAt: merchant.created_at_ms,
    UpdatedAt: merchant.updated_at_ms
  };
}

export function serializeOrder(order: OrderRow): Record<string, unknown> {
  return {
    ID: order.id,
    MerchantId: order.merchant_id,
    TradeId: order.trade_id,
    OrderId: order.order_id,
    BlockTransactionId: order.block_transaction_id || "",
    Amount: centsToDecimal(order.amount_cents),
    ActualAmount: unitsToToken(order.actual_amount_units, order.actual_amount_scale),
    Type: order.currency,
    Token: order.token,
    Status: order.status,
    NotifyUrl: order.notify_url,
    RedirectUrl: order.redirect_url,
    CallbackNum: order.callback_num,
    CallBackConfirm: order.callback_confirm,
    StartTime: order.start_time_ms,
    ExpirationTime: order.expiration_time_ms,
    CreatedAt: order.created_at_ms,
    UpdatedAt: order.updated_at_ms
  };
}

export function serializeSettings(settings: SettingsRow, secure: Record<string, string>): Record<string, unknown> {
  return {
    ID: 1,
    AppUrl: settings.app_url,
    AppName: settings.app_name,
    CustomerServiceContact: settings.customer_service_contact,
    SecretKey: mask(secure.merchant_signing_secret),
    Httpport: 443,
    ExpirationDate: settings.order_expiration_seconds,
    PayStatusMinIntervalSeconds: settings.pay_status_min_interval_seconds,
    CallbackMaxAttempts: settings.callback_max_attempts,
    ScanOrderLimit: settings.scan_order_limit,
    ScanGroupLimit: settings.scan_group_limit,
    FreeTierMode: settings.free_tier_mode === 1,
    TurnstileRequired: settings.turnstile_required === 1,
    Tgbotkey: mask(secure.telegram_bot_token),
    Tgchatid: mask(secure.telegram_chat_id),
    Barkkey: mask(secure.bark_key),
    Redishost: "Cloudflare Queues",
    Redisport: 0,
    Redisdb: 0
  };
}

export function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}********${value.slice(-4)}`;
}
