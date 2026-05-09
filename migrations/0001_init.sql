PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  deleted_at_ms INTEGER
);

CREATE TABLE IF NOT EXISTS merchants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  deleted_at_ms INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
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
);

CREATE TABLE IF NOT EXISTS secure_settings (
  key TEXT PRIMARY KEY,
  value_ciphertext TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_addresses (
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
);

CREATE TABLE IF NOT EXISTS orders (
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
);

CREATE TABLE IF NOT EXISTS callback_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_cache (
  currency_symbol TEXT PRIMARY KEY,
  rate_scaled INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  client_key TEXT NOT NULL,
  route TEXT NOT NULL,
  detail TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at_ms);
CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status, deleted_at_ms);
CREATE INDEX IF NOT EXISTS idx_wallet_merchant_currency_status ON wallet_addresses(merchant_id, currency, status, deleted_at_ms);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_order_id ON orders(merchant_id, order_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_expiration ON orders(status, expiration_time_ms);
CREATE INDEX IF NOT EXISTS idx_orders_status_next_scan ON orders(status, next_scan_at_ms);
CREATE INDEX IF NOT EXISTS idx_orders_currency_token_status ON orders(currency, token, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_block_tx_unique
  ON orders(block_transaction_id)
  WHERE block_transaction_id IS NOT NULL AND block_transaction_id != '';
CREATE INDEX IF NOT EXISTS idx_callback_next ON callback_jobs(status, next_attempt_at_ms);

INSERT OR IGNORE INTO users (
  username,
  password_hash,
  role,
  created_at_ms,
  updated_at_ms
) VALUES (
  'admin',
  'md5$7488e331b8b64e5794da3fa4eb10ad5d',
  'admin',
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

INSERT OR IGNORE INTO settings (
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
);

INSERT OR IGNORE INTO merchants (
  merchant_id,
  name,
  status,
  created_at_ms,
  updated_at_ms
) VALUES (
  'default',
  'Default Merchant',
  1,
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);
