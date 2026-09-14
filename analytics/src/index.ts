export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders: Record<string, string> = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
    };

    // CORS preflight for API
    if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Tracker.js — serve from static assets with JS content-type + CORS
    if (url.pathname === '/tracker.js') {
      try {
        const assetRes = await env.ASSETS.fetch(request);
        if (!assetRes.ok) {
          return new Response(`// tracker.js asset not ok: ${assetRes.status}`, { status: 404, headers: { 'content-type': 'application/javascript' } });
        }
        return new Response(assetRes.body, {
          status: 200,
          headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'access-control-allow-origin': '*',
            'cache-control': 'public, max-age=3600',
          },
        });
      } catch (err: any) {
        return new Response(`// ASSETS error: ${err?.message || String(err)} | has ASSETS: ${!!env.ASSETS}`, {
          status: 500,
          headers: { 'content-type': 'application/javascript' },
        });
      }
    }

    // API: ingest events (batch or single)
    if (url.pathname === '/api/events' && request.method === 'POST') {
      const body = await request.json();
      const events: Record<string, unknown>[] = Array.isArray(body) ? body : [body];
      const ttl = 60 * 60 * 24 * 90;
      const promises = events.map((event) =>
        env.chimera_analytics_events.put(
          `event:${event.ts || Date.now()}:${crypto.randomUUID()}`,
          JSON.stringify(event),
          { expirationTtl: ttl },
        ),
      );
      await Promise.all(promises);
      return new Response(JSON.stringify({ ok: true, count: events.length }), {
        headers: { 'content-type': 'application/json', ...corsHeaders },
      });
    }

    // API: list events (optionally filtered by siteId)
    if (url.pathname === '/api/events' && request.method === 'GET') {
      const siteId = url.searchParams.get('siteId');
      const events: unknown[] = [];
      let cursor: string | undefined;
      do {
        const list = await env.chimera_analytics_events.list({ prefix: 'event:', cursor, limit: 1000 });
        const values = await Promise.all(
          list.keys.map((k: { name: string }) => env.chimera_analytics_events.get(k.name)),
        );
        for (const v of values) {
          if (!v) continue;
          try {
            const parsed = JSON.parse(v);
            if (!siteId || parsed.siteId === siteId) events.push(parsed);
          } catch {}
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);
      return new Response(JSON.stringify({ events }), {
        headers: { 'content-type': 'application/json', ...corsHeaders },
      });
    }

    // API: chimera escrow channel
    if (url.pathname === '/api/chimera/escrow' && request.method === 'POST') {
      const body = await request.json();
      return new Response(JSON.stringify({ ok: true, channel: body }), {
        headers: { 'content-type': 'application/json', ...corsHeaders },
      });
    }

    // Everything else — serve static assets (dashboard, embed-example, etc.)
    if (url.pathname.startsWith('/dashboard') || url.pathname === '/embed-example.html') {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.ok) return assetRes;
      // SPA fallback for dashboard routes
      if (url.pathname.startsWith('/dashboard')) {
        const indexReq = new Request(new URL('/dashboard/index.html', url.origin), {
          method: 'GET',
          headers: request.headers,
        });
        const indexRes = await env.ASSETS.fetch(indexReq);
        if (indexRes.ok) return indexRes;
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
