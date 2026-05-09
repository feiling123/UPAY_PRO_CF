import { t } from "./i18n.js";

const tabs = document.querySelectorAll("[data-tab]");
const sections = document.querySelectorAll(".tab");
const adminBase = location.pathname.replace(/\/+$/g, "");
let page = 1;

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    sections.forEach((section) => section.classList.add("hidden"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.tab}`).classList.remove("hidden");
  });
});

document.querySelector("#logoutBtn").addEventListener("click", async () => {
  await fetch(adminPath("/logout"), { method: "POST" });
  location.href = adminBase || "/";
});

await refreshAll();

async function refreshAll() {
  await Promise.all([loadStats(), loadOrders(), loadWallets(), loadSettings(), loadApiKeys(), loadMerchants(), loadTools(), loadUsers()]);
}

async function api(path, options = {}) {
  const response = await fetch(adminPath(path), options);
  if (response.status === 401) location.href = adminBase || "/";
  return response.json();
}

function adminPath(path) {
  if (path.startsWith("/admin/")) return `${adminBase}${path.slice("/admin".length)}`;
  return path;
}

async function loadStats() {
  const result = await api("/admin/api/stats");
  const data = result.data || {};
  document.querySelector("#stats").innerHTML = [
    [t("admin.stats.users"), data.userCount],
    [t("admin.stats.waiting"), data.waitOrderCount],
    [t("admin.stats.success"), data.successOrderCount],
    [t("admin.stats.expired"), data.expiredOrderCount],
    [t("admin.stats.wallets"), data.walletCount],
    [t("admin.stats.callback_failed"), data.callbackFailedCount]
  ].map(([label, value]) => `<div class="stat"><span class="muted">${label}</span><strong>${value ?? 0}</strong></div>`).join("");
}

async function loadOrders() {
  const result = await api(`/admin/api/orders?page=${page}&limit=20`);
  const orders = result.data?.orders || [];
  document.querySelector("#orders").innerHTML = `
    <h2>${t("admin.orders.title")}</h2>
    <div class="actions">
      <button id="prevPage">${t("admin.orders.prev")}</button>
      <button id="nextPage">${t("admin.orders.next")}</button>
      <button id="refreshOrders">${t("admin.orders.refresh")}</button>
    </div>
    <table>
      <thead><tr><th>${t("admin.orders.system")}</th><th>${t("admin.orders.merchant_id")}</th><th>${t("admin.orders.merchant")}</th><th>${t("admin.orders.currency")}</th><th>${t("admin.orders.amount")}</th><th>${t("admin.orders.wallet")}</th><th>${t("admin.orders.status")}</th><th>${t("admin.orders.actions")}</th></tr></thead>
      <tbody>
        ${orders.map((order) => `
          <tr>
            <td>${escapeHtml(order.TradeId)}</td>
            <td>${escapeHtml(order.MerchantId || "default")}</td>
            <td>${escapeHtml(order.OrderId)}</td>
            <td>${escapeHtml(order.Type)}</td>
            <td>${order.ActualAmount}</td>
            <td>${escapeHtml(short(order.Token))}</td>
            <td>${status(order.Status)}</td>
            <td><button data-complete="${escapeHtml(order.TradeId)}">${t("admin.orders.complete")}</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;
  document.querySelector("#prevPage").onclick = () => { page = Math.max(1, page - 1); loadOrders(); };
  document.querySelector("#nextPage").onclick = () => { page += 1; loadOrders(); };
  document.querySelector("#refreshOrders").onclick = loadOrders;
  document.querySelectorAll("[data-complete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/admin/api/manual-complete-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: button.dataset.complete })
      });
      await refreshAll();
    });
  });
}

async function loadWallets() {
  const meta = await api("/api/meta");
  const merchants = await merchantOptions();
  const result = await api("/admin/api/wallets");
  const wallets = result.data || [];
  const currencyOptions = (meta.currencies || []).map((item) => `<option value="${item}">${item}</option>`).join("");
  document.querySelector("#wallets").innerHTML = `
    <h2>${t("admin.wallets.title")}</h2>
    <form id="walletForm" class="form-grid">
      <input type="hidden" name="wallet_id" />
      <label>${t("admin.merchants.id")} <select name="merchant_id">${merchants}</select></label>
      <label>${t("admin.orders.currency")} <select name="currency">${currencyOptions}</select></label>
      <label>${t("admin.wallets.address")} <input name="token" required /></label>
      <label>${t("admin.wallets.rate")} <input name="rate" type="number" step="0.000001" required /></label>
      <label>${t("admin.orders.status")} <select name="status"><option value="1">${t("admin.wallets.enabled")}</option><option value="2">${t("admin.wallets.disabled")}</option></select></label>
      <label>${t("admin.wallets.auto_rate")} <select name="AutoRate"><option value="false">${t("admin.wallets.off")}</option><option value="true">${t("admin.wallets.on")}</option></select></label>
      <button class="primary" type="submit" id="walletSubmit">${t("admin.wallets.add")}</button>
    </form>
    <table>
      <thead><tr><th>${t("admin.merchants.id")}</th><th>${t("admin.orders.currency")}</th><th>${t("admin.wallets.address")}</th><th>${t("admin.wallets.rate")}</th><th>${t("admin.orders.status")}</th><th>${t("admin.orders.actions")}</th></tr></thead>
      <tbody>${wallets.map((wallet) => `
        <tr>
          <td>${escapeHtml(wallet.MerchantId || "default")}</td>
          <td>${wallet.Currency}</td>
          <td>${escapeHtml(short(wallet.Token))}</td>
          <td>${wallet.Rate}</td>
          <td>${wallet.Status === 1 ? t("admin.wallets.enabled") : t("admin.wallets.disabled")}</td>
          <td>
            <button data-edit-wallet="${wallet.ID}" data-merchant="${escapeAttr(wallet.MerchantId || "default")}" data-currency="${escapeAttr(wallet.Currency)}" data-token="${escapeAttr(wallet.Token)}" data-rate="${wallet.Rate}" data-status="${wallet.Status}" data-auto-rate="${wallet.AutoRate}">${t("admin.wallets.edit")}</button>
            <button class="danger" data-delete-wallet="${wallet.ID}">${t("admin.wallets.delete")}</button>
          </td>
        </tr>`).join("")}</tbody>
    </table>`;
  document.querySelector("#walletForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const walletId = form.get("wallet_id");
    await api(walletId ? `/admin/api/wallets/${walletId}` : "/admin/api/wallets", {
      method: walletId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currency: form.get("currency"),
        merchant_id: form.get("merchant_id"),
        token: form.get("token"),
        rate: Number(form.get("rate")),
        status: Number(form.get("status")),
        AutoRate: form.get("AutoRate") === "true"
      })
    });
    await refreshAll();
  };
  document.querySelectorAll("[data-edit-wallet]").forEach((button) => {
    button.onclick = () => {
      const form = document.querySelector("#walletForm");
      form.elements.wallet_id.value = button.dataset.editWallet;
      form.elements.merchant_id.value = button.dataset.merchant || "default";
      form.elements.currency.value = button.dataset.currency;
      form.elements.token.value = button.dataset.token;
      form.elements.rate.value = button.dataset.rate;
      form.elements.status.value = button.dataset.status;
      form.elements.AutoRate.value = button.dataset.autoRate === "true" ? "true" : "false";
      document.querySelector("#walletSubmit").textContent = t("admin.wallets.save");
    };
  });
  document.querySelectorAll("[data-delete-wallet]").forEach((button) => {
    button.onclick = async () => {
      await api(`/admin/api/wallets/${button.dataset.deleteWallet}`, { method: "DELETE" });
      await refreshAll();
    };
  });
}

async function loadSettings() {
  const result = await api("/admin/api/settings");
  const data = result.data || {};
  document.querySelector("#settings").innerHTML = `
    <h2>${t("admin.settings.title")}</h2>
    <form id="settingsForm" class="form-grid">
      <label>${t("admin.settings.app_url")} <input name="appurl" value="${escapeAttr(data.AppUrl || "")}" /></label>
      <label>${t("admin.settings.app_name")} <input name="appname" value="${escapeAttr(data.AppName || "")}" /></label>
      <label>${t("admin.settings.contact")} <input name="customerservicecontact" value="${escapeAttr(data.CustomerServiceContact || "")}" /></label>
      <label>${t("admin.settings.expiration")} <input name="expirationdate" type="number" value="${data.ExpirationDate || 300}" /></label>
      <label>${t("admin.settings.poll")} <input name="pay_status_min_interval_seconds" type="number" value="${data.PayStatusMinIntervalSeconds || 8}" /></label>
      <label>${t("admin.settings.callback")} <input name="callback_max_attempts" type="number" value="${data.CallbackMaxAttempts || 5}" /></label>
      <label>${t("admin.settings.scan_order_limit")} <input name="scan_order_limit" type="number" value="${data.ScanOrderLimit || 100}" /></label>
      <label>${t("admin.settings.scan_group_limit")} <input name="scan_group_limit" type="number" value="${data.ScanGroupLimit || 20}" /></label>
      <label>${t("admin.settings.free_tier")} <select name="free_tier_mode"><option value="true" ${data.FreeTierMode ? "selected" : ""}>${t("admin.wallets.on")}</option><option value="false" ${!data.FreeTierMode ? "selected" : ""}>${t("admin.wallets.off")}</option></select></label>
      <label>${t("admin.settings.turnstile")} <select name="turnstile_required"><option value="false" ${!data.TurnstileRequired ? "selected" : ""}>${t("admin.wallets.off")}</option><option value="true" ${data.TurnstileRequired ? "selected" : ""}>${t("admin.wallets.on")}</option></select></label>
      <label>${t("admin.settings.secret")} <input name="secretkey" placeholder="${escapeAttr(data.SecretKey || t("common.not_set"))}" /></label>
      <label>${t("admin.settings.telegram_bot")} <input name="tgbotkey" placeholder="${escapeAttr(data.Tgbotkey || t("common.not_set"))}" /></label>
      <label>${t("admin.settings.telegram_chat")} <input name="tgchatid" placeholder="${escapeAttr(data.Tgchatid || t("common.not_set"))}" /></label>
      <label>${t("admin.settings.bark")} <input name="barkkey" placeholder="${escapeAttr(data.Barkkey || t("common.not_set"))}" /></label>
      <button class="primary" type="submit">${t("admin.settings.save")}</button>
    </form>`;
  document.querySelector("#settingsForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    await api("/admin/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    await refreshAll();
  };
}

async function loadApiKeys() {
  const result = await api("/admin/api/apikeys");
  const data = result.data || {};
  document.querySelector("#apikeys").innerHTML = `
    <h2>${t("admin.apikeys.title")}</h2>
    <form id="apiKeyForm" class="form-grid">
      <label>Tronscan <input name="tronscan" placeholder="${escapeAttr(data.Tronscan || t("common.not_set"))}" /></label>
      <label>TronGrid <input name="trongrid" placeholder="${escapeAttr(data.Trongrid || t("common.not_set"))}" /></label>
      <label>Etherscan V2 <input name="etherscan" placeholder="${escapeAttr(data.Etherscan || t("common.not_set"))}" /></label>
      <button class="primary" type="submit">${t("admin.apikeys.save")}</button>
    </form>`;
  document.querySelector("#apiKeyForm").onsubmit = async (event) => {
    event.preventDefault();
    await api("/admin/api/apikeys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries()))
    });
    await refreshAll();
  };
}

async function loadMerchants() {
  const result = await api("/admin/api/merchants");
  const merchants = result.data || [];
  document.querySelector("#merchants").innerHTML = `
    <h2>${t("admin.merchants.title")}</h2>
    <form id="merchantForm" class="form-grid">
      <label>${t("admin.merchants.id")} <input name="merchant_id" pattern="[A-Za-z0-9_-]{3,64}" required /></label>
      <label>${t("admin.merchants.name")} <input name="name" required /></label>
      <label>${t("admin.merchants.secret")} <input name="signing_secret" placeholder="${t("admin.merchants.secret_placeholder")}" /></label>
      <button class="primary" type="submit">${t("admin.merchants.add")}</button>
    </form>
    <form id="merchantUpdateForm" class="form-grid">
      <label>${t("admin.merchants.id")} <select name="merchant_id">${merchants.map((merchant) => `<option value="${escapeAttr(merchant.MerchantId)}">${escapeHtml(merchant.MerchantId)} - ${escapeHtml(merchant.Name)}</option>`).join("")}</select></label>
      <label>${t("admin.merchants.name")} <input name="name" /></label>
      <label>${t("admin.orders.status")} <select name="status"><option value="1">${t("admin.wallets.enabled")}</option><option value="2">${t("admin.wallets.disabled")}</option></select></label>
      <label>${t("admin.merchants.secret")} <input name="signing_secret" placeholder="${t("admin.merchants.secret_placeholder")}" /></label>
      <button class="primary" type="submit">${t("admin.merchants.save")}</button>
    </form>
    <div id="merchantCreateResult" class="notice hidden"></div>
    <table>
      <thead><tr><th>${t("admin.merchants.id")}</th><th>${t("admin.merchants.name")}</th><th>${t("admin.orders.status")}</th><th>${t("admin.merchants.secret")}</th></tr></thead>
      <tbody>${merchants.map((merchant) => `
        <tr>
          <td>${escapeHtml(merchant.MerchantId)}</td>
          <td>${escapeHtml(merchant.Name)}</td>
          <td>${merchant.Status === 1 ? t("admin.wallets.enabled") : t("admin.wallets.disabled")}</td>
          <td>${escapeHtml(merchant.SigningSecret || "")}</td>
        </tr>`).join("")}</tbody>
    </table>`;
  document.querySelector("#merchantForm").onsubmit = async (event) => {
    event.preventDefault();
    const result = await api("/admin/api/merchants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries()))
    });
    const box = document.querySelector("#merchantCreateResult");
    box.classList.remove("hidden");
    box.innerHTML = result.data?.SigningSecretPlain
      ? `<strong>${t("admin.merchants.created")}</strong><div class="address">${escapeHtml(result.data.SigningSecretPlain)}</div>`
      : escapeHtml(result.message || "Failed");
    event.target.reset();
  };
  document.querySelector("#merchantUpdateForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const merchantId = form.get("merchant_id");
    await api(`/admin/api/merchants/${encodeURIComponent(merchantId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    event.target.reset();
    await loadMerchants();
  };
}

async function loadTools() {
  const meta = await api("/api/meta");
  const merchants = await merchantOptions();
  const currencyOptions = (meta.currencies || []).map((item) => `<option value="${item}">${item}</option>`).join("");
  document.querySelector("#tools").innerHTML = `
    <h2>${t("admin.tools.title")}</h2>
    <p class="muted">${t("admin.tools.hint")}</p>
    <form id="testOrderForm" class="form-grid">
      <label>${t("admin.merchants.id")} <select name="merchant_id">${merchants}</select></label>
      <label>${t("admin.orders.currency")} <select name="type">${currencyOptions}</select></label>
      <label>${t("admin.orders.amount")} <input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>${t("admin.tools.order_id")} <input name="order_id" data-i18n-placeholder="admin.tools.order_placeholder" placeholder="${t("admin.tools.order_placeholder")}" /></label>
      <label>${t("admin.tools.notify_url")} <input name="notify_url" placeholder="${t("admin.tools.notify_placeholder")}" /></label>
      <label>${t("admin.tools.redirect_url")} <input name="redirect_url" placeholder="${t("admin.tools.redirect_placeholder")}" /></label>
      <button class="primary" type="submit">${t("admin.tools.create")}</button>
    </form>
    <div id="testOrderResult" class="notice hidden"></div>`;
  document.querySelector("#testOrderForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const result = await api("/admin/api/test-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: form.get("type"),
        merchant_id: form.get("merchant_id"),
        amount: Number(form.get("amount")),
        order_id: form.get("order_id"),
        notify_url: form.get("notify_url"),
        redirect_url: form.get("redirect_url")
      })
    });
    const url = result.data?.payment_url || result.data?.data?.payment_url;
    const box = document.querySelector("#testOrderResult");
    box.classList.remove("hidden");
    box.innerHTML = url
      ? `<strong>${t("admin.tools.created")}</strong><div class="address">${escapeHtml(url)}</div><div class="actions"><a class="button primary" target="_blank" rel="noopener" href="${escapeAttr(url)}">${t("admin.tools.created")}</a><button id="copyPaymentUrl">${t("admin.tools.copy")}</button></div>`
      : escapeHtml(result.message || "Failed");
    document.querySelector("#copyPaymentUrl")?.addEventListener("click", () => navigator.clipboard.writeText(url));
    await loadOrders();
  };
}

async function merchantOptions() {
  const result = await api("/admin/api/merchants");
  const merchants = result.data?.length ? result.data : [{ MerchantId: "default", Name: "Default Merchant" }];
  return merchants.map((merchant) => `<option value="${escapeAttr(merchant.MerchantId)}">${escapeHtml(merchant.MerchantId)} - ${escapeHtml(merchant.Name || merchant.MerchantId)}</option>`).join("");
}

async function loadUsers() {
  const result = await api("/admin/api/users");
  const users = result.data || [];
  document.querySelector("#users").innerHTML = `
    <h2>${t("admin.users.title")}</h2>
    <table><thead><tr><th>ID</th><th>${t("login.username")}</th><th>${t("admin.users.role")}</th></tr></thead>
    <tbody>${users.map((user) => `<tr><td>${user.ID}</td><td>${escapeHtml(user.UserName)}</td><td>${user.Role}</td></tr>`).join("")}</tbody></table>
    <h3>${t("admin.users.password_title")}</h3>
    <form id="passwordForm" class="form-grid">
      <label>${t("admin.users.user_id")} <input name="userId" type="number" required /></label>
      <label>${t("admin.users.new_password")} <input name="newPassword" type="password" minlength="6" required /></label>
      <button class="primary" type="submit">${t("admin.users.change_password")}</button>
    </form>`;
  document.querySelector("#passwordForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    await api("/admin/api/users/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: Number(form.get("userId")), newPassword: form.get("newPassword") })
    });
    event.target.reset();
  };
}

function status(value) {
  if (value === 2) return `<span class="status ok">${t("status.success")}</span>`;
  if (value === 3) return `<span class="status bad">${t("status.expired")}</span>`;
  return `<span class="status wait">${t("status.waiting")}</span>`;
}

function short(value) {
  if (!value || value.length < 16) return value || "";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
