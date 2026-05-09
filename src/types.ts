export type OrderStatus = 1 | 2 | 3;
export type CallbackConfirm = 1 | 2;

export interface Env {
  ASSETS?: Fetcher;
  DB: D1Database;
  WALLET_ALLOCATOR: DurableObjectNamespace;
  ORDER_SCAN_QUEUE?: Queue<ScanMessage>;
  ORDER_EXPIRATION_QUEUE?: Queue<ExpirationMessage>;
  CALLBACK_QUEUE?: Queue<CallbackMessage>;
  APP_NAME?: string;
  APP_URL?: string;
  ADMIN_PATH?: string;
  ORDER_EXPIRATION_SECONDS?: string;
  PAY_STATUS_MIN_INTERVAL_SECONDS?: string;
  CALLBACK_MAX_ATTEMPTS?: string;
  CRON_SCAN_ORDER_LIMIT?: string;
  CRON_SCAN_GROUP_LIMIT?: string;
  FREE_TIER_MODE?: string;
  LEGACY_MD5_ENABLED?: string;
  TURNSTILE_REQUIRED?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ADMIN_JWT_SECRET?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  MERCHANT_SIGNING_SECRET?: string;
  TRONSCAN_API_KEY?: string;
  TRONGRID_API_KEY?: string;
  ETHERSCAN_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  BARK_KEY?: string;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  created_at_ms: number;
  updated_at_ms: number;
  deleted_at_ms: number | null;
}

export interface SettingsRow {
  id: 1;
  app_url: string;
  app_name: string;
  customer_service_contact: string;
  order_expiration_seconds: number;
  pay_status_min_interval_seconds: number;
  callback_max_attempts: number;
  scan_order_limit: number;
  scan_group_limit: number;
  free_tier_mode: number;
  turnstile_required: number;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface MerchantRow {
  id: number;
  merchant_id: string;
  name: string;
  status: number;
  created_at_ms: number;
  updated_at_ms: number;
  deleted_at_ms: number | null;
}

export interface WalletRow {
  id: number;
  merchant_id: string;
  currency: string;
  token: string;
  status: number;
  rate_scaled: number;
  rate_scale: number;
  auto_rate: number;
  created_at_ms: number;
  updated_at_ms: number;
  deleted_at_ms: number | null;
}

export interface OrderRow {
  id: number;
  merchant_id: string;
  trade_id: string;
  order_id: string;
  block_transaction_id: string | null;
  amount_cents: number;
  actual_amount_units: number;
  actual_amount_scale: number;
  currency: string;
  token: string;
  status: OrderStatus;
  notify_url: string;
  redirect_url: string;
  callback_num: number;
  callback_confirm: CallbackConfirm;
  scan_attempts: number;
  next_scan_at_ms: number | null;
  view_token_hash: string;
  start_time_ms: number;
  expiration_time_ms: number;
  created_at_ms: number;
  updated_at_ms: number;
  deleted_at_ms: number | null;
}

export interface PublicOrder {
  trade_id: string;
  order_id: string;
  amount: number;
  actual_amount: number;
  currency: string;
  token: string;
  status: OrderStatus;
  expiration_time: number;
  redirect_url: string;
  app_name: string;
  customer_service_contact: string;
}

export interface ScanMessage {
  kind: "scan";
  reason: "created" | "cron" | "retry" | "manual";
  tradeId?: string;
}

export interface ExpirationMessage {
  kind: "expire";
  tradeId: string;
}

export interface CallbackMessage {
  kind: "callback";
  tradeId: string;
  attempt?: number;
}

export interface ChainTransfer {
  txId: string;
  to: string;
  amountUnits: number;
  timestampMs: number;
  symbol: string;
}

export interface AllocateWalletRequest {
  currency: string;
  amountCents: number;
  tradeId: string;
  expiresAtMs: number;
  maxIncrements: number;
  incrementUnits: number;
  wallets: Array<{
    id: number;
    token: string;
    rateScaled: number;
    rateScale: number;
  }>;
}

export interface AllocateWalletResponse {
  token: string;
  actualAmountUnits: number;
  walletId: number;
  rateScaled: number;
}
