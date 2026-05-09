import type { Env } from "../types";

export async function verifyTurnstile(env: Env, token: string | undefined, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return env.TURNSTILE_REQUIRED !== "true";
  if (!token) return false;
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body
  });
  if (!response.ok) return false;
  const result = await response.json<{ success: boolean; hostname?: string }>();
  return result.success === true;
}
