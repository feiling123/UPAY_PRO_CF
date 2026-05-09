import type { Context } from "hono";

export function jsonOk<T>(c: Context, data: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify({ code: 0, msg: "success", data }), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) }
  });
}

export function jsonMessage(c: Context, message: string, status = 400, code = 1): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export function clientIp(c: Context): string {
  return (
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

export function requireJson(c: Context, maxBytes = 4096): Response | null {
  const contentType = c.req.header("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonMessage(c, "Content-Type must be application/json", 415);
  }
  const contentLength = Number(c.req.header("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return jsonMessage(c, "Request body too large", 413);
  }
  return null;
}

export async function readJsonLimited<T = unknown>(c: Context, maxBytes = 4096): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const invalid = requireJson(c, maxBytes);
  if (invalid) return { ok: false, response: invalid };
  if (!c.req.raw.body) return { ok: false, response: jsonMessage(c, "参数错误", 400) };

  const reader = c.req.raw.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, response: jsonMessage(c, "Request body too large", 413) };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, data: JSON.parse(new TextDecoder().decode(bytes)) as T };
  } catch {
    return { ok: false, response: jsonMessage(c, "参数错误", 400) };
  }
}

export function noStoreHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff"
  };
}
