/**
 * code.widespread.fyi → delta-git reverse proxy.
 *
 * Thin edge hop: rewrites the request URL to the delta-git upstream and
 * stamps X-Forwarded-Host/-Proto so the upstream emits public-facing URLs
 * against code.widespread.fyi (see delta-git src/worker/common/origin.ts —
 * the upstream only honors forwarded hosts that match its PUBLIC_ORIGIN,
 * which is set to this hostname).
 *
 * Always overwrites any client-supplied forwarded headers so a spoofed
 * X-Forwarded-Host can't reach the upstream allowlist check.
 */
interface Env {
  UPSTREAM_ORIGIN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const upstream = env.UPSTREAM_ORIGIN ?? "https://git-on-cloudflare.delta-git.workers.dev";
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, upstream);

    const proxied = new Request(target.toString(), request);
    proxied.headers.set("x-forwarded-host", url.host);
    proxied.headers.set("x-forwarded-proto", url.protocol.replace(/:$/, ""));

    // Manual so 30x reach the client untouched — upstream Location headers
    // already carry the public origin via the forwarded-host handling.
    return fetch(proxied, { redirect: "manual" });
  },
} satisfies ExportedHandler;
