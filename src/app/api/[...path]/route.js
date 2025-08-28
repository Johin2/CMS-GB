export const dynamic = 'force-dynamic';

const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'; // no trailing slash

async function forward(req, { params }) {
  const url = new URL(req.url);
  const path = (params.path || []).join('/');
  const target = `${BACKEND.replace(/\/+$/,'')}/${path}${url.search}`;

  const init = {
    method: req.method,
    headers: Object.fromEntries(
      [...req.headers.entries()].filter(([k]) => k.toLowerCase() !== 'host')
    ),
    // Only pass a body for methods that can have one
    body: ['GET','HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
  };

  const res = await fetch(target, init);
  return new Response(await res.arrayBuffer(), {
    status: res.status,
    headers: res.headers,
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE, forward as OPTIONS };
