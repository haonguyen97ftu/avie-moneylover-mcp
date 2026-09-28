import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpServer } from '../src/httpServer.js';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test('HTTP server exposes health and protects MCP endpoint', async (t) => {
  const server = createHttpServer({
    publicUrl: 'https://mcp.example.test',
    authSecret: '0123456789abcdef0123456789abcdef',
    ownerPassword: 'a-very-long-owner-password',
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = await listen(server);

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const mcp = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(mcp.status, 401);
  assert.match(mcp.headers.get('www-authenticate'), /oauth-protected-resource/);
});
