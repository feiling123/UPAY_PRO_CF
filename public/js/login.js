import { t } from "./i18n.js";

const form = document.querySelector("#loginForm");
const message = document.querySelector("#message");
const adminBase = deriveAdminBase();
let turnstileSiteKey = "";

const meta = await fetch("/api/meta").then((r) => r.json()).catch(() => ({}));
turnstileSiteKey = meta.turnstile_site_key || "";
if (turnstileSiteKey && window.turnstile) {
  window.turnstile.render("#turnstile", {
    sitekey: turnstileSiteKey,
    action: "admin_login"
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const tokenInput = document.querySelector("input[name='cf-turnstile-response']");
  const payload = {
    username: data.get("username"),
    password: data.get("password"),
    turnstile_token: tokenInput?.value || ""
  };
  const response = await fetch(`${adminBase}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok && result.code === 0) {
    location.href = result.redirect || adminBase;
    return;
  }
  message.classList.remove("hidden");
  message.textContent = result.message || t("login.failed", "登录失败");
  if (window.turnstile) window.turnstile.reset();
});

function deriveAdminBase() {
  const path = location.pathname.replace(/\/+$/g, "");
  if (!path) return "";
  if (path.endsWith("/login")) return path.slice(0, -6) || "";
  return path;
}
