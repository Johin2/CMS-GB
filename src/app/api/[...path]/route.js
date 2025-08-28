// Runtime: Node.js (default). If you run on edge, remove arrayBuffer usage or adapt.
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:8000';

async function proxy(request, { params }) {
  const segments = Array.isArray(params?.path) ? params.path : [];
  const base = API_TARGET.replace(/\/+$/, '');
  const srcUrl = new URL(request.url);
  const destUrl = `${base}/api/${segments.join('/')}${srcUrl.search}`;

  // Forward headers except hop-by-hop
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');

  const method = request.method || 'GET';
  const hasBody = !['GET', 'HEAD'].includes(method);
  const body = hasBody ? await request.arrayBuffer().catch(() => undefined) : undefined;

  const upstream = await fetch(destUrl, {
    method,
    headers,
    body,
    // Avoid caching proxy responses in Next
    cache: 'no-store',
  });

  // Pass-through response (status, headers, body)
  const outHeaders = new Headers(upstream.headers);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export async function GET(req, ctx)    { return proxy(req, ctx); }
export async function POST(req, ctx)   { return proxy(req, ctx); }
export async function PUT(req, ctx)    { return proxy(req, ctx); }
export async function PATCH(req, ctx)  { return proxy(req, ctx); }
export async function DELETE(req, ctx) { return proxy(req, ctx); }
export async function OPTIONS(req, ctx){ return proxy(req, ctx); }
