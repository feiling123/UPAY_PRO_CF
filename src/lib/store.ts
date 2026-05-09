import type { Env, MerchantRow, OrderRow, SettingsRow, UserRow, WalletRow } from "../types";
import { decryptSecret, encryptSecret } from "./crypto";
import { requiredSecret } from "./secrets";
import { nowMs } from "./time";

export class Store {
  constructor(private readonly env: Env) {}

  async settings(): Promise<SettingsRow> {
    const row = await this.env.DB.prepare("SELECT * FROM settings WHERE id = 1").first<SettingsRow>();
    if (row) return row;
    const timestamp = nowMs();
    await this.env.DB.prepare(
      `INSERT INTO settings (id, app_url, app_name, created_at_ms, updated_at_ms)
       VALUES (1, ?, ?, ?, ?)`
    ).bind(this.env.APP_URL || "", this.env.APP_NAME || "UPay Pro", timestamp, timestamp).run();
    return (await this.env.DB.prepare("SELECT * FROM settings WHERE id = 1").first<SettingsRow>())!;
  }

  async updateSettings(input: Partial<SettingsRow>): Promise<void> {
    const allowed = [
      "app_url",
      "app_name",
      "customer_service_contact",
      "order_expiration_seconds",
      "pay_status_min_interval_seconds",
      "callback_max_attempts",
      "scan_order_limit",
      "scan_group_limit",
      "free_tier_mode",
      "turnstile_required"
    ] as const;
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
      if (input[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(input[key]);
      }
    }
    if (updates.length === 0) return;
    updates.push("updated_at_ms = ?");
    values.push(nowMs());
    values.push(1);
    await this.env.DB.prepare(`UPDATE settings SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  }

  async getSecure(key: string, envFallback?: string): Promise<string> {
    const row = await this.env.DB.prepare("SELECT value_ciphertext FROM secure_settings WHERE key = ?")
      .bind(key)
      .first<{ value_ciphertext: string }>();
    if (!row) return envFallback || "";
    try {
      return await decryptSecret(requiredSecret("CONFIG_ENCRYPTION_KEY", this.env.CONFIG_ENCRYPTION_KEY), row.value_ciphertext);
    } catch {
      return "";
    }
  }

  async setSecure(key: string, value: string): Promise<void> {
    const timestamp = nowMs();
    const encrypted = await encryptSecret(requiredSecret("CONFIG_ENCRYPTION_KEY", this.env.CONFIG_ENCRYPTION_KEY), value);
    await this.env.DB.prepare(
      `INSERT INTO secure_settings (key, value_ciphertext, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_ciphertext = excluded.value_ciphertext, updated_at_ms = excluded.updated_at_ms`
    ).bind(key, encrypted, timestamp, timestamp).run();
  }

  async firstUser(): Promise<UserRow | null> {
    return this.env.DB.prepare("SELECT * FROM users WHERE deleted_at_ms IS NULL ORDER BY id ASC LIMIT 1").first<UserRow>();
  }

  async userByUsername(username: string): Promise<UserRow | null> {
    return this.env.DB.prepare("SELECT * FROM users WHERE username = ? AND deleted_at_ms IS NULL")
      .bind(username)
      .first<UserRow>();
  }

  async createUser(username: string, passwordHash: string): Promise<void> {
    const timestamp = nowMs();
    await this.env.DB.prepare(
      `INSERT INTO users (username, password_hash, role, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'admin', ?, ?)`
    ).bind(username, passwordHash, timestamp, timestamp).run();
  }

  async updatePassword(userId: number, passwordHash: string): Promise<boolean> {
    const result = await this.env.DB.prepare("UPDATE users SET password_hash = ?, updated_at_ms = ? WHERE id = ? AND deleted_at_ms IS NULL")
      .bind(passwordHash, nowMs(), userId)
      .run();
    return result.meta.changes > 0;
  }

  async listUsers(): Promise<UserRow[]> {
    return this.env.DB.prepare("SELECT * FROM users WHERE deleted_at_ms IS NULL ORDER BY id ASC").all<UserRow>().then((r) => r.results || []);
  }

  async listMerchants(): Promise<MerchantRow[]> {
    await this.ensureDefaultMerchant();
    return this.env.DB.prepare("SELECT * FROM merchants WHERE deleted_at_ms IS NULL ORDER BY id ASC").all<MerchantRow>().then((r) => r.results || []);
  }

  async merchantById(merchantId: string): Promise<MerchantRow | null> {
    await this.ensureDefaultMerchant();
    return this.env.DB.prepare("SELECT * FROM merchants WHERE merchant_id = ? AND deleted_at_ms IS NULL")
      .bind(merchantId)
      .first<MerchantRow>();
  }

  async createMerchant(input: { merchant_id: string; name: string; signing_secret: string; status?: number }): Promise<MerchantRow> {
    const timestamp = nowMs();
    const row = await this.env.DB.prepare(
      `INSERT INTO merchants (merchant_id, name, status, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    ).bind(input.merchant_id, input.name, input.status ?? 1, timestamp, timestamp).first<MerchantRow>();
    if (!row) throw new Error("merchant insert failed");
    await this.setMerchantSecret(input.merchant_id, input.signing_secret);
    return row;
  }

  async updateMerchant(merchantId: string, input: { name?: string; status?: number; signing_secret?: string }): Promise<boolean> {
    const existing = await this.merchantById(merchantId);
    if (!existing) return false;
    const updates: string[] = [];
    const values: unknown[] = [];
    if (input.name !== undefined) {
      updates.push("name = ?");
      values.push(input.name);
    }
    if (input.status !== undefined) {
      updates.push("status = ?");
      values.push(input.status);
    }
    if (updates.length) {
      updates.push("updated_at_ms = ?");
      values.push(nowMs(), merchantId);
      const result = await this.env.DB.prepare(`UPDATE merchants SET ${updates.join(", ")} WHERE merchant_id = ? AND deleted_at_ms IS NULL`)
        .bind(...values)
        .run();
      if (result.meta.changes === 0) return false;
    }
    if (input.signing_secret) await this.setMerchantSecret(merchantId, input.signing_secret);
    return true;
  }

  async getMerchantSecret(merchantId: string): Promise<string> {
    const normalized = merchantId || "default";
    if (normalized === "default") {
      return this.getSecure("merchant:default:signing_secret", await this.getSecure("merchant_signing_secret", this.env.MERCHANT_SIGNING_SECRET));
    }
    return this.getSecure(`merchant:${normalized}:signing_secret`);
  }

  async setMerchantSecret(merchantId: string, secret: string): Promise<void> {
    await this.setSecure(`merchant:${merchantId || "default"}:signing_secret`, secret);
    if ((merchantId || "default") === "default") await this.setSecure("merchant_signing_secret", secret);
  }

  async ensureDefaultMerchant(): Promise<void> {
    const timestamp = nowMs();
    await this.env.DB.prepare(
      `INSERT OR IGNORE INTO merchants (merchant_id, name, status, created_at_ms, updated_at_ms)
       VALUES ('default', 'Default Merchant', 1, ?, ?)`
    ).bind(timestamp, timestamp).run();
  }

  async listWallets(): Promise<WalletRow[]> {
    return this.env.DB.prepare("SELECT * FROM wallet_addresses WHERE deleted_at_ms IS NULL ORDER BY id DESC").all<WalletRow>().then((r) => r.results || []);
  }

  async enabledWallets(merchantId: string, currency: string): Promise<WalletRow[]> {
    return this.env.DB.prepare(
      `SELECT * FROM wallet_addresses
       WHERE merchant_id = ? AND currency = ? AND status = 1 AND deleted_at_ms IS NULL
       ORDER BY id ASC`
    ).bind(merchantId || "default", currency).all<WalletRow>().then((r) => r.results || []);
  }

  async createWallet(input: Pick<WalletRow, "merchant_id" | "currency" | "token" | "status" | "rate_scaled" | "rate_scale" | "auto_rate">): Promise<WalletRow> {
    const timestamp = nowMs();
    const result = await this.env.DB.prepare(
      `INSERT INTO wallet_addresses (merchant_id, currency, token, status, rate_scaled, rate_scale, auto_rate, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    ).bind(input.merchant_id || "default", input.currency, input.token, input.status, input.rate_scaled, input.rate_scale, input.auto_rate, timestamp, timestamp)
      .first<WalletRow>();
    if (!result) throw new Error("wallet insert failed");
    return result;
  }

  async updateWallet(id: number, input: Partial<Pick<WalletRow, "merchant_id" | "currency" | "token" | "status" | "rate_scaled" | "rate_scale" | "auto_rate">>): Promise<boolean> {
    const allowed = ["merchant_id", "currency", "token", "status", "rate_scaled", "rate_scale", "auto_rate"] as const;
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
      if (input[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(input[key]);
      }
    }
    if (updates.length === 0) return true;
    updates.push("updated_at_ms = ?");
    values.push(nowMs(), id);
    const result = await this.env.DB.prepare(`UPDATE wallet_addresses SET ${updates.join(", ")} WHERE id = ? AND deleted_at_ms IS NULL`)
      .bind(...values)
      .run();
    return result.meta.changes > 0;
  }

  async deleteWallet(id: number): Promise<boolean> {
    const result = await this.env.DB.prepare("UPDATE wallet_addresses SET deleted_at_ms = ?, updated_at_ms = ? WHERE id = ? AND deleted_at_ms IS NULL")
      .bind(nowMs(), nowMs(), id)
      .run();
    return result.meta.changes > 0;
  }

  async latestPendingByOrderId(orderId: string, merchantId = "default"): Promise<OrderRow | null> {
    return this.env.DB.prepare(
      `SELECT * FROM orders
       WHERE merchant_id = ? AND order_id = ? AND status = 1 AND deleted_at_ms IS NULL
       ORDER BY id DESC LIMIT 1`
    ).bind(merchantId, orderId).first<OrderRow>();
  }

  async latestByOrderId(orderId: string, merchantId = "default"): Promise<OrderRow | null> {
    return this.env.DB.prepare(
      `SELECT * FROM orders
       WHERE merchant_id = ? AND order_id = ? AND deleted_at_ms IS NULL
       ORDER BY id DESC LIMIT 1`
    ).bind(merchantId, orderId).first<OrderRow>();
  }

  async latestByAnyMerchantOrderId(orderId: string): Promise<OrderRow | null> {
    return this.env.DB.prepare(
      `SELECT * FROM orders
       WHERE order_id = ? AND deleted_at_ms IS NULL
       ORDER BY id DESC LIMIT 1`
    ).bind(orderId).first<OrderRow>();
  }

  async orderByTradeId(tradeId: string): Promise<OrderRow | null> {
    return this.env.DB.prepare("SELECT * FROM orders WHERE trade_id = ? AND deleted_at_ms IS NULL")
      .bind(tradeId)
      .first<OrderRow>();
  }

  async createOrder(input: Omit<OrderRow, "id" | "block_transaction_id" | "callback_num" | "callback_confirm" | "scan_attempts" | "created_at_ms" | "updated_at_ms" | "deleted_at_ms">): Promise<OrderRow> {
    const timestamp = nowMs();
    const row = await this.env.DB.prepare(
      `INSERT INTO orders (
        merchant_id, trade_id, order_id, amount_cents, actual_amount_units, actual_amount_scale, currency,
        token, status, notify_url, redirect_url, next_scan_at_ms, view_token_hash,
        start_time_ms, expiration_time_ms, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`
    ).bind(
      input.merchant_id || "default",
      input.trade_id,
      input.order_id,
      input.amount_cents,
      input.actual_amount_units,
      input.actual_amount_scale,
      input.currency,
      input.token,
      input.status,
      input.notify_url,
      input.redirect_url,
      input.next_scan_at_ms,
      input.view_token_hash,
      input.start_time_ms,
      input.expiration_time_ms,
      timestamp,
      timestamp
    ).first<OrderRow>();
    if (!row) throw new Error("order insert failed");
    return row;
  }

  async refreshPendingOrder(order: OrderRow, expirationTimeMs: number): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE orders SET expiration_time_ms = ?, next_scan_at_ms = ?, updated_at_ms = ?
       WHERE trade_id = ? AND status = 1`
    ).bind(expirationTimeMs, nowMs() + 10_000, nowMs(), order.trade_id).run();
  }

  async listOrders(page: number, limit: number, search: string): Promise<{ orders: OrderRow[]; total: number }> {
    const offset = (page - 1) * limit;
    const filter = search ? "AND (trade_id LIKE ? OR order_id LIKE ? OR merchant_id LIKE ?)" : "";
    const args = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
    const total = await this.env.DB.prepare(`SELECT COUNT(*) AS count FROM orders WHERE deleted_at_ms IS NULL ${filter}`)
      .bind(...args)
      .first<{ count: number }>();
    const orders = await this.env.DB.prepare(
      `SELECT * FROM orders WHERE deleted_at_ms IS NULL ${filter}
       ORDER BY id DESC LIMIT ? OFFSET ?`
    ).bind(...args, limit, offset).all<OrderRow>().then((r) => r.results || []);
    return { orders, total: total?.count || 0 };
  }

  async stats(): Promise<{ userCount: number; successOrderCount: number; waitOrderCount: number; expiredOrderCount: number; walletCount: number; callbackFailedCount: number }> {
    const [users, success, waiting, expired, wallets, callbacks] = await Promise.all([
      this.count("users", "deleted_at_ms IS NULL"),
      this.count("orders", "status = 2 AND deleted_at_ms IS NULL"),
      this.count("orders", "status = 1 AND deleted_at_ms IS NULL"),
      this.count("orders", "status = 3 AND deleted_at_ms IS NULL"),
      this.count("wallet_addresses", "deleted_at_ms IS NULL"),
      this.count("callback_jobs", "status = 'failed'")
    ]);
    return {
      userCount: users,
      successOrderCount: success,
      waitOrderCount: waiting,
      expiredOrderCount: expired,
      walletCount: wallets,
      callbackFailedCount: callbacks
    };
  }

  async pendingOrdersForScan(limit: number): Promise<OrderRow[]> {
    const timestamp = nowMs();
    return this.env.DB.prepare(
      `SELECT * FROM orders
       WHERE status = 1 AND deleted_at_ms IS NULL AND expiration_time_ms > ?
         AND (next_scan_at_ms IS NULL OR next_scan_at_ms <= ?)
       ORDER BY next_scan_at_ms ASC, id ASC
       LIMIT ?`
    ).bind(timestamp, timestamp, limit).all<OrderRow>().then((r) => r.results || []);
  }

  async markOrderPaid(tradeId: string, txId: string): Promise<boolean> {
    const result = await this.env.DB.prepare(
      `UPDATE orders
       SET status = 2, block_transaction_id = ?, updated_at_ms = ?
       WHERE trade_id = ? AND status = 1`
    ).bind(txId, nowMs(), tradeId).run();
    return result.meta.changes > 0;
  }

  async forceOrderPaid(tradeId: string, txId: string): Promise<boolean> {
    const result = await this.env.DB.prepare(
      `UPDATE orders
       SET status = 2, block_transaction_id = ?, updated_at_ms = ?
       WHERE trade_id = ? AND status != 2 AND deleted_at_ms IS NULL`
    ).bind(txId, nowMs(), tradeId).run();
    return result.meta.changes > 0;
  }

  async markExpired(tradeId: string): Promise<boolean> {
    const result = await this.env.DB.prepare(
      `UPDATE orders SET status = 3, updated_at_ms = ?
       WHERE trade_id = ? AND status = 1`
    ).bind(nowMs(), tradeId).run();
    return result.meta.changes > 0;
  }

  async expireDueOrders(limit: number): Promise<OrderRow[]> {
    const due = await this.env.DB.prepare(
      `SELECT * FROM orders
       WHERE status = 1 AND deleted_at_ms IS NULL AND expiration_time_ms <= ?
       ORDER BY expiration_time_ms ASC LIMIT ?`
    ).bind(nowMs(), limit).all<OrderRow>().then((r) => r.results || []);
    for (const order of due) await this.markExpired(order.trade_id);
    return due;
  }

  async scheduleNextScan(tradeId: string, delayMs: number): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE orders
       SET scan_attempts = scan_attempts + 1, next_scan_at_ms = ?, updated_at_ms = ?
       WHERE trade_id = ? AND status = 1`
    ).bind(nowMs() + delayMs, nowMs(), tradeId).run();
  }

  async enqueueCallback(tradeId: string, delayMs = 0): Promise<void> {
    const timestamp = nowMs();
    await this.env.DB.prepare(
      `INSERT INTO callback_jobs (trade_id, attempt, next_attempt_at_ms, status, created_at_ms, updated_at_ms)
       SELECT ?, 0, ?, 'pending', ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM callback_jobs WHERE trade_id = ? AND status = 'pending'
       )`
    ).bind(tradeId, timestamp + delayMs, timestamp, timestamp, tradeId).run();
  }

  async claimCallback(tradeId: string, leaseMs = 120_000): Promise<boolean> {
    const timestamp = nowMs();
    const result = await this.env.DB.prepare(
      `UPDATE callback_jobs
       SET status = 'processing', next_attempt_at_ms = ?, updated_at_ms = ?
       WHERE trade_id = ?
         AND (status = 'pending' OR (status = 'processing' AND next_attempt_at_ms <= ?))`
    ).bind(timestamp + leaseMs, timestamp, tradeId, timestamp).run();
    return result.meta.changes > 0;
  }

  async markCallbackConfirmed(tradeId: string): Promise<void> {
    await this.env.DB.batch([
      this.env.DB.prepare("UPDATE orders SET callback_confirm = 1, updated_at_ms = ? WHERE trade_id = ?").bind(nowMs(), tradeId),
      this.env.DB.prepare("UPDATE callback_jobs SET status = 'done', updated_at_ms = ? WHERE trade_id = ? AND status IN ('pending', 'processing')").bind(nowMs(), tradeId)
    ]);
  }

  async incrementCallbackFailure(tradeId: string, error: string, nextAttemptAtMs: number, failed: boolean): Promise<void> {
    await this.env.DB.batch([
      this.env.DB.prepare("UPDATE orders SET callback_num = callback_num + 1, updated_at_ms = ? WHERE trade_id = ?").bind(nowMs(), tradeId),
      this.env.DB.prepare(
        `UPDATE callback_jobs
         SET attempt = attempt + 1, next_attempt_at_ms = ?, last_error = ?, status = ?, updated_at_ms = ?
         WHERE trade_id = ? AND status IN ('pending', 'processing')`
      ).bind(nextAttemptAtMs, error.slice(0, 500), failed ? "failed" : "pending", nowMs(), tradeId)
    ]);
  }

  async dueCallbacks(limit: number): Promise<Array<{ trade_id: string; attempt: number }>> {
    return this.env.DB.prepare(
      `SELECT trade_id, attempt FROM callback_jobs
       WHERE status IN ('pending', 'processing') AND next_attempt_at_ms <= ?
       ORDER BY next_attempt_at_ms ASC LIMIT ?`
    ).bind(nowMs(), limit).all<{ trade_id: string; attempt: number }>().then((r) => r.results || []);
  }

  async setRate(symbol: string, rateScaled: number, source: string): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO rate_cache (currency_symbol, rate_scaled, source, fetched_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(currency_symbol) DO UPDATE SET rate_scaled = excluded.rate_scaled, source = excluded.source, fetched_at_ms = excluded.fetched_at_ms`
    ).bind(symbol, rateScaled, source, nowMs()).run();
  }

  async updateAutoRateWallets(symbol: string, rateScaled: number): Promise<void> {
    const patterns = symbol === "TRX" ? ["TRX"] : [`${symbol}-%`];
    for (const pattern of patterns) {
      await this.env.DB.prepare(
        `UPDATE wallet_addresses
         SET rate_scaled = ?, updated_at_ms = ?
         WHERE auto_rate = 1 AND deleted_at_ms IS NULL AND currency LIKE ?`
      ).bind(rateScaled, nowMs(), pattern).run();
    }
  }

  async latestWalletForCurrency(merchantId: string, currency: string): Promise<WalletRow | null> {
    return this.env.DB.prepare(
      `SELECT * FROM wallet_addresses
       WHERE merchant_id = ? AND currency = ? AND deleted_at_ms IS NULL
       ORDER BY id DESC LIMIT 1`
    ).bind(merchantId || "default", currency).first<WalletRow>();
  }

  private async count(table: string, where: string): Promise<number> {
    const row = await this.env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).first<{ count: number }>();
    return row?.count || 0;
  }
}
