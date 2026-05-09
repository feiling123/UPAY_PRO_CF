import { app } from "./http/app";
import jobs, { WalletAllocator } from "./jobs";
import { adminPublicPath } from "./lib/admin-path";
import type { Env } from "./types";

export { WalletAllocator };

const dynamicPrefixes = [
  "/api/",
  "/pay/check-status/",
  "/pay/checkout-counter/"
];

const blockedAdminPaths = ["/admin", "/admin/", "/admin.html", "/login", "/login.html"];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const adminBase = adminPublicPath(env);
    if (adminBase && isAdminPath(url.pathname, adminBase)) {
      const mappedUrl = mapAdminUrl(url, adminBase);
      if (!mappedUrl) return nginx404();
      return app.fetch(new Request(mappedUrl, request), env, ctx);
    }
    if (url.pathname === "/" || url.pathname === "/index.html" || blockedAdminPaths.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) {
      return nginx404();
    }
    if (dynamicPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
      return app.fetch(request, env, ctx);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return app.fetch(request, env, ctx);
  },

  scheduled: jobs.scheduled,
  queue: jobs.queue
};

function isAdminPath(pathname: string, adminBase: string): boolean {
  return pathname === adminBase || pathname.startsWith(`${adminBase}/`);
}

function mapAdminUrl(url: URL, adminBase: string): URL | null {
  const suffix = url.pathname === adminBase ? "/" : url.pathname.slice(adminBase.length);
  const mapped = new URL(url);
  if (suffix === "" || suffix === "/") {
    mapped.pathname = "/admin";
    return mapped;
  }
  if (suffix === "/login") {
    mapped.pathname = "/login";
    return mapped;
  }
  if (suffix === "/logout") {
    mapped.pathname = "/admin/logout";
    return mapped;
  }
  if (suffix.startsWith("/api/")) {
    mapped.pathname = `/admin/api/${suffix.slice(5)}`;
    return mapped;
  }
  return null;
}

function nginx404(): Response {
  return new Response(
    `<html>
<head><title>404 Not Found</title></head>
<body>
<center><h1>404 Not Found</h1></center>
<hr><center>nginx</center>
</body>
</html>`,
    {
      status: 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}
