import type { Env } from "../types";

let schemaReady: Promise<void> | null = null;

export async function ensureSchema(env: Env): Promise<void> {
  if (!env.DB) throw new Error("D1 binding DB is not configured");
  if (!schemaReady) {
    schemaReady = ensureSchemaOnce(env).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function ensureSchemaOnce(env: Env): Promise<void> {
  for (const statement of TABLE_STATEMENTS) {
    await env.DB.prepare(statement).run();
  }
  await ensureRequiredColumns(env);
  for (const statement of INDEX_STATEMENTS) {
    await env.DB.prepare(statement).run();
  }
  await ensureDefaultAdmin(env);
  await ensureDefaultSettings(env);
  await ensureDefaultMerchant(env);
}

async function ensureDefaultAdmin(env: Env): Promise<void> {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = 'admin' AND deleted_at_ms IS NULL LIMIT 1").first();
  if (existing) return;
  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, role, created_at_ms, updated_at_ms)
     VALUES ('admin', ?, 'admin', unixepoch('now') * 1000, unixepoch('now') * 1000)`
  ).bind(DEFAULT_ADMIN_PASSWORD_HASH).run();
}

async function ensureDefaultMerchant(env: Env): Promise<void> {
  const existing = await env.DB.prepare("SELECT id FROM merchants WHERE merchant_id = 'default' AND deleted_at_ms IS NULL LIMIT 1").first();
  if (existing) return;
  await env.DB.prepare(
    `INSERT INTO merchants (merchant_id, name, status, created_at_ms, updated_at_ms)
     VALUES ('default', 'Default Merchant', 1, unixepoch('now') * 1000, unixepoch('now') * 1000)`
  ).run();
}

async function ensureDefaultSettings(env: Env): Promise<void> {
  const existing = await env.DB.prepare("SELECT id FROM settings WHERE id = 1 LIMIT 1").first();
  if (existing) return;
  await env.DB.prepare(
    `INSERT INTO settings (
       id,
       app_url,
       app_name,
       customer_service_contact,
       order_expiration_seconds,
       pay_status_min_interval_seconds,
       callback_max_attempts,
       scan_order_limit,
       scan_group_limit,
       free_tier_mode,
       turnstile_required,
       created_at_ms,
       updated_at_ms
     ) VALUES (
       1,
       '',
       'UPay Pro',
       '',
       300,
       8,
       5,
       100,
       20,
       1,
       0,
       unixepoch('now') * 1000,
       unixepoch('now') * 1000
     )`
  ).run();
}

async function ensureRequiredColumns(env: Env): Promise<void> {
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const existing = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const names = new Set((existing.results || []).map((column) => column.name));
    for (const column of columns) {
      if (!names.has(column.name)) {
        await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column.sql}`).run();
      }
    }
  }
}

const DEFAULT_ADMIN_PASSWORD_HASH = "md5$7488e331b8b64e5794da3fa4eb10ad5d";

const TABLE_STATEMENTS = [
`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  deleted_at_ms INTEGER
)`,
`CREATE TABLE IF NOT EXISTS merchants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  deleted_at_ms INTEGER
)`,
`CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  app_url TEXT NOT NULL DEFAULT '',
  app_name TEXT NOT NULL DEFAULT 'UPay Pro',
  customer_service_contact TEXT NOT NULL DEFAULT '',
  order_expiration_seconds INTEGER NOT NULL DEFAULT 300,
  pay_status_min_interval_seconds INTEGER NOT NULL DEFAULT 8,
  callback_max_attempts INTEGER NOT NULL DEFAULT 5,
  scan_order_limit INTEGER NOT NULL DEFAULT 100,
  scan_group_limit INTEGER NOT NULL DEFAULT 20,
  free_tier_mode INTEGER NOT NULL DEFAULT 1,
  turnstile_required INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS secure_settings (
  key TEXT PRIMARY KEY,
  value_ciphertext TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS wallet_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL DEFAULT 'default',
  currency TEXT NOT NULL,
  token TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 1,
  rate_scaled INTEGER NOT NULL,
  rate_scale INTEGER NOT NULL DEFAULT 1000000,
  auto_rate INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  deleted_at_ms INTEGER,
  UNIQUE(merchant_id, currency, token)
)`,
`CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL DEFAULT 'default',
  trade_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  block_transaction_id TEXT,
  amount_cents INTEGER NOT NULL,
  actual_amount_units INTEGER NOT NULL,
  actual_amount_scale INTEGER NOT NULL DEFAULT 1000000,
  currency TEXT NOT NULL,
  token TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 1,
  notify_url TEXT NOT NULL,
  redirect_url TEXT NOT NULL,
  callback_num INTEGER NOT NULL DEFAULT 0,
  callback_confirm INTEGER NOT NULL DEFAULT 2,
  scan_attempts INTEGER NOT NULL DEFAULT 0,
  next_scan_at_ms INTEGER,
  view_token_hash TEXT NOT NULL,
  start_time_ms INTEGER NOT NULL,
  expiration_time_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  deleted_at_ms INTEGER
)`,
`CREATE TABLE IF NOT EXISTS callback_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS rate_cache (
  currency_symbol TEXT PRIMARY KEY,
  rate_scaled INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at_ms INTEGER NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  client_key TEXT NOT NULL,
  route TEXT NOT NULL,
  detail TEXT,
  created_at_ms INTEGER NOT NULL
)`,
];

const INDEX_STATEMENTS = [
`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username) WHERE username IS NOT NULL`,
`CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at_ms)`,
`CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_merchant_id_unique ON merchants(merchant_id) WHERE merchant_id IS NOT NULL`,
`CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status, deleted_at_ms)`,
`CREATE INDEX IF NOT EXISTS idx_wallet_merchant_currency_status ON wallet_addresses(merchant_id, currency, status, deleted_at_ms)`,
`CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id, id DESC)`,
`CREATE INDEX IF NOT EXISTS idx_orders_merchant_order_id ON orders(merchant_id, order_id, id DESC)`,
`CREATE INDEX IF NOT EXISTS idx_orders_status_expiration ON orders(status, expiration_time_ms)`,
`CREATE INDEX IF NOT EXISTS idx_orders_status_next_scan ON orders(status, next_scan_at_ms)`,
`CREATE INDEX IF NOT EXISTS idx_orders_currency_token_status ON orders(currency, token, status)`,
`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_block_tx_unique
  ON orders(block_transaction_id)
  WHERE block_transaction_id IS NOT NULL AND block_transaction_id != ''`,
`CREATE INDEX IF NOT EXISTS idx_callback_next ON callback_jobs(status, next_attempt_at_ms)`
];

const REQUIRED_COLUMNS: Record<string, Array<{ name: string; sql: string }>> = {
  users: [
    { name: "username", sql: "username TEXT" },
    { name: "password_hash", sql: "password_hash TEXT" },
    { name: "role", sql: "role TEXT NOT NULL DEFAULT 'admin'" },
    { name: "created_at_ms", sql: "created_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "updated_at_ms", sql: "updated_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "deleted_at_ms", sql: "deleted_at_ms INTEGER" }
  ],
  merchants: [
    { name: "merchant_id", sql: "merchant_id TEXT" },
    { name: "name", sql: "name TEXT NOT NULL DEFAULT ''" },
    { name: "status", sql: "status INTEGER NOT NULL DEFAULT 1" },
    { name: "created_at_ms", sql: "created_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "updated_at_ms", sql: "updated_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "deleted_at_ms", sql: "deleted_at_ms INTEGER" }
  ],
  settings: [
    { name: "id", sql: "id INTEGER" },
    { name: "app_url", sql: "app_url TEXT NOT NULL DEFAULT ''" },
    { name: "app_name", sql: "app_name TEXT NOT NULL DEFAULT 'UPay Pro'" },
    { name: "customer_service_contact", sql: "customer_service_contact TEXT NOT NULL DEFAULT ''" },
    { name: "order_expiration_seconds", sql: "order_expiration_seconds INTEGER NOT NULL DEFAULT 300" },
    { name: "pay_status_min_interval_seconds", sql: "pay_status_min_interval_seconds INTEGER NOT NULL DEFAULT 8" },
    { name: "callback_max_attempts", sql: "callback_max_attempts INTEGER NOT NULL DEFAULT 5" },
    { name: "scan_order_limit", sql: "scan_order_limit INTEGER NOT NULL DEFAULT 100" },
    { name: "scan_group_limit", sql: "scan_group_limit INTEGER NOT NULL DEFAULT 20" },
    { name: "free_tier_mode", sql: "free_tier_mode INTEGER NOT NULL DEFAULT 1" },
    { name: "turnstile_required", sql: "turnstile_required INTEGER NOT NULL DEFAULT 0" },
    { name: "created_at_ms", sql: "created_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "updated_at_ms", sql: "updated_at_ms INTEGER NOT NULL DEFAULT 0" }
  ],
  secure_settings: [
    { name: "key", sql: "key TEXT" },
    { name: "value_ciphertext", sql: "value_ciphertext TEXT NOT NULL DEFAULT ''" },
    { name: "created_at_ms", sql: "created_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "updated_at_ms", sql: "updated_at_ms INTEGER NOT NULL DEFAULT 0" }
  ],
  wallet_addresses: [
    { name: "merchant_id", sql: "merchant_id TEXT NOT NULL DEFAULT 'default'" },
    { name: "currency", sql: "currency TEXT NOT NULL DEFAULT ''" },
    { name: "token", sql: "token TEXT NOT NULL DEFAULT ''" },
    { name: "status", sql: "status INTEGER NOT NULL DEFAULT 1" },
    { name: "rate_scaled", sql: "rate_scaled INTEGER NOT NULL DEFAULT 0" },
    { name: "rate_scale", sql: "rate_scale INTEGER NOT NULL DEFAULT 1000000" },
    { name: "auto_rate", sql: "auto_rate INTEGER NOT NULL DEFAULT 0" },
    { name: "created_at_ms", sql: "created_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "updated_at_ms", sql: "updated_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "deleted_at_ms", sql: "deleted_at_ms INTEGER" }
  ],
  orders: [
    { name: "merchant_id", sql: "merchant_id TEXT NOT NULL DEFAULT 'default'" },
    { name: "trade_id", sql: "trade_id TEXT NOT NULL DEFAULT ''" },
    { name: "order_id", sql: "order_id TEXT NOT NULL DEFAULT ''" },
    { name: "block_transaction_id", sql: "block_transaction_id TEXT" },
    { name: "amount_cents", sql: "amount_cents INTEGER NOT NULL DEFAULT 0" },
    { name: "actual_amount_units", sql: "actual_amount_units INTEGER NOT NULL DEFAULT 0" },
    { name: "actual_amount_scale", sql: "actual_amount_scale INTEGER NOT NULL DEFAULT 1000000" },
    { name: "currency", sql: "currency TEXT NOT NULL DEFAULT ''" },
    { name: "token", sql: "token TEXT NOT NULL DEFAULT ''" },
    { name: "status", sql: "status INTEGER NOT NULL DEFAULT 1" },
    { name: "notify_url", sql: "notify_url TEXT NOT NULL DEFAULT ''" },
    { name: "redirect_url", sql: "redirect_url TEXT NOT NULL DEFAULT ''" },
    { name: "callback_num", sql: "callback_num INTEGER NOT NULL DEFAULT 0" },
    { name: "callback_confirm", sql: "callback_confirm INTEGER NOT NULL DEFAULT 2" },
    { name: "scan_attempts", sql: "scan_attempts INTEGER NOT NULL DEFAULT 0" },
    { name: "next_scan_at_ms", sql: "next_scan_at_ms INTEGER" },
    { name: "view_token_hash", sql: "view_token_hash TEXT NOT NULL DEFAULT ''" },
    { name: "start_time_ms", sql: "start_time_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "expiration_time_ms", sql: "expiration_time_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "created_at_ms", sql: "created_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "updated_at_ms", sql: "updated_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "deleted_at_ms", sql: "deleted_at_ms INTEGER" }
  ],
  callback_jobs: [
    { name: "trade_id", sql: "trade_id TEXT NOT NULL DEFAULT ''" },
    { name: "attempt", sql: "attempt INTEGER NOT NULL DEFAULT 0" },
    { name: "next_attempt_at_ms", sql: "next_attempt_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "last_error", sql: "last_error TEXT" },
    { name: "status", sql: "status TEXT NOT NULL DEFAULT 'pending'" },
    { name: "created_at_ms", sql: "created_at_ms INTEGER NOT NULL DEFAULT 0" },
    { name: "updated_at_ms", sql: "updated_at_ms INTEGER NOT NULL DEFAULT 0" }
  ],
  rate_cache: [
    { name: "currency_symbol", sql: "currency_symbol TEXT" },
    { name: "rate_scaled", sql: "rate_scaled INTEGER NOT NULL DEFAULT 0" },
    { name: "source", sql: "source TEXT NOT NULL DEFAULT ''" },
    { name: "fetched_at_ms", sql: "fetched_at_ms INTEGER NOT NULL DEFAULT 0" }
  ],
  security_events: [
    { name: "event_type", sql: "event_type TEXT NOT NULL DEFAULT ''" },
    { name: "client_key", sql: "client_key TEXT NOT NULL DEFAULT ''" },
    { name: "route", sql: "route TEXT NOT NULL DEFAULT ''" },
    { name: "detail", sql: "detail TEXT" },
    { name: "created_at_ms", sql: "created_at_ms INTEGER NOT NULL DEFAULT 0" }
  ]
};
