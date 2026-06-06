export async function onRequestGet() {
  return Response.json({
    ok: true,
    service: 'game-advisor-api',
    runtime: 'cloudflare-pages-functions',
  });
}
