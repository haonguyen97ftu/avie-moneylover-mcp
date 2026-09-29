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

test('OAuth browser flow advertises and returns issuer identification', async (t) => {
  const events = [];
  const server = createHttpServer({
    publicUrl: 'https://mcp.example.test',
    authSecret: '0123456789abcdef0123456789abcdef',
    ownerPassword: 'a-very-long-owner-password',
    logger: {
      info: (message) => events.push(message),
      warn: (message) => events.push(message),
    },
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = await listen(server);

  const metadata = await fetch(`${base}/.well-known/oauth-authorization-server`).then((response) => response.json());
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);

  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const registration = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [redirectUri] }),
  }).then((response) => response.json());
  const authorization = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: 'challenge',
    resource: 'https://mcp.example.test',
    state: 'opaque-state',
    owner_password: 'a-very-long-owner-password',
  });

  const approved = await fetch(`${base}/oauth/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: authorization,
    redirect: 'manual',
  });
  assert.equal(approved.status, 302);
  const approvedLocation = new URL(approved.headers.get('location'));
  assert.equal(approvedLocation.origin + approvedLocation.pathname, redirectUri);
  assert.ok(approvedLocation.searchParams.get('code'));
  assert.equal(approvedLocation.searchParams.get('state'), 'opaque-state');
  assert.equal(approvedLocation.searchParams.get('iss'), 'https://mcp.example.test');
  assert.deepEqual(events, ['[oauth] authorization_succeeded']);

  authorization.set('owner_password', 'wrong-password');
  const denied = await fetch(`${base}/oauth/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: authorization,
    redirect: 'manual',
  });
  assert.equal(denied.status, 302);
  const deniedLocation = new URL(denied.headers.get('location'));
  assert.equal(deniedLocation.searchParams.get('error'), 'access_denied');
  assert.equal(deniedLocation.searchParams.get('state'), 'opaque-state');
  assert.equal(deniedLocation.searchParams.get('iss'), 'https://mcp.example.test');
  assert.deepEqual(events, ['[oauth] authorization_succeeded', '[oauth] authorization_failed']);
});
