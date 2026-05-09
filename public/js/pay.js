import { t } from "./i18n.js";

const params = new URLSearchParams(location.search);
const tradeId = params.get("trade_id") || location.pathname.split("/").pop();
const pv = params.get("pv") || "";
const loading = document.querySelector("#loading");
const payment = document.querySelector("#payment");
const statusBox = document.querySelector("#status");
let order;
let timer;
let nextPollMs = 10_000;

if (!tradeId || !pv) {
  fail(t("pay.missing"));
} else {
  loadOrder();
}

async function loadOrder() {
  const response = await fetch(`/api/public/orders/${encodeURIComponent(tradeId)}?pv=${encodeURIComponent(pv)}`);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.data) {
    fail(t("pay.not_found"));
    return;
  }
  order = result.data;
  renderOrder(order);
  tickCountdown();
  checkStatus();
}

function renderOrder(data) {
  loading.classList.add("hidden");
  payment.classList.remove("hidden");
  document.querySelector("#currency").textContent = data.currency;
  document.querySelector("#amount").textContent = `${data.actual_amount} ${data.currency.split("-")[0]}`;
  document.querySelector("#address").textContent = data.token;
  document.querySelector("#tradeId").textContent = data.trade_id;
  document.title = `${data.currency} ${t("pay.waiting")}`;
  if (window.qrcode) {
    const qr = window.qrcode(0, "M");
    qr.addData(data.token);
    qr.make();
    document.querySelector("#qr").innerHTML = qr.createImgTag(5, 8);
  }
}

async function checkStatus(force = false) {
  if (!order) return;
  if (document.hidden && !force) {
    schedule(Math.max(nextPollMs, 30_000));
    return;
  }
  const response = await fetch(`/pay/check-status/${encodeURIComponent(order.trade_id)}?pv=${encodeURIComponent(pv)}`);
  const retryAfter = Number(response.headers.get("Retry-After") || 0);
  const result = await response.json().catch(() => ({}));
  if (response.status === 429) {
    schedule((retryAfter || 10) * 1000);
    return;
  }
  const status = result.data?.status;
  nextPollMs = result.next_poll_after_ms || adaptiveDelay();
  if (status === 2) {
    statusBox.textContent = t("pay.success");
    statusBox.className = "notice status ok";
    clearTimeout(timer);
    setTimeout(() => { location.href = order.redirect_url; }, 1200);
    return;
  }
  if (status === 3 || Date.now() > order.expiration_time) {
    statusBox.textContent = t("pay.expired");
    statusBox.className = "notice status bad";
    clearTimeout(timer);
    return;
  }
  statusBox.textContent = t("pay.confirming");
  schedule(nextPollMs);
}

function adaptiveDelay() {
  const age = Date.now() - (order.expiration_time - 600_000);
  if (age < 90_000) return 8_000;
  if (age < 300_000) return 15_000;
  return 30_000;
}

function schedule(delay) {
  clearTimeout(timer);
  const jitter = Math.round(delay * (1 + Math.random() * 0.2));
  timer = setTimeout(() => checkStatus(), jitter);
}

function tickCountdown() {
  const remain = Math.max(0, order.expiration_time - Date.now());
  const minutes = Math.floor(remain / 60_000);
  const seconds = Math.floor((remain % 60_000) / 1000);
  document.querySelector("#countdown").textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
  if (remain > 0) requestAnimationFrame(tickCountdown);
}

function fail(text) {
  loading.textContent = text;
}

document.querySelector("#copyBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(order.token);
});

document.querySelector("#refreshBtn").addEventListener("click", () => checkStatus(true));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkStatus(true);
});
