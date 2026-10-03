import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../src/httpServer.js';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

function fakeJwt(expSecondsFromNow = 3600) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })}.sig`;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
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
    owner_password: '  a-very-long-owner-password\n',
  });

  const consent = await fetch(`${base}/oauth/authorize?${authorization}`);
  assert.equal(consent.status, 200);
  assert.match(consent.headers.get('content-security-policy'), /form-action 'self' https:\/\/chatgpt\.com;/);
  assert.equal(consent.headers.get('referrer-policy'), 'no-referrer');
  assert.doesNotMatch(await consent.text(), /name="owner_password" value=/);

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
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('content-security-policy'), /form-action 'self' https:\/\/chatgpt\.com;/);
  assert.equal(denied.headers.get('location'), null);
  const deniedHtml = await denied.text();
  assert.match(deniedHtml, /Incorrect owner password/);
  assert.match(deniedHtml, /MCP_OWNER_PASSWORD/);
  assert.doesNotMatch(deniedHtml, /value="wrong-password"/);
  assert.deepEqual(events, ['[oauth] authorization_succeeded', '[oauth] authorization_failed reason=incorrect_password']);
});

test('OAuth refresh survives an HTTP server restart with the same secret', async (t) => {
  const events = [];
  const config = {
    publicUrl: 'https://mcp.example.test',
    authSecret: '0123456789abcdef0123456789abcdef',
    ownerPassword: 'a-very-long-owner-password',
    logger: {
      info: (message) => events.push(message),
      warn: (message) => events.push(message),
    },
  };
  const firstServer = createHttpServer(config);
  const firstBase = await listen(firstServer);
  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const registration = await fetch(`${firstBase}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [redirectUri] }),
  }).then((response) => response.json());
  const verifier = 'a'.repeat(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorization = new URLSearchParams({
    response_type: 'code', client_id: registration.client_id, redirect_uri: redirectUri,
    code_challenge_method: 'S256', code_challenge: challenge,
    resource: config.publicUrl, scope: 'moneylover:read moneylover:write',
    owner_password: config.ownerPassword,
  });
  const approved = await fetch(`${firstBase}/oauth/authorize`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: authorization, redirect: 'manual',
  });
  assert.equal(approved.status, 302);
  const code = new URL(approved.headers.get('location')).searchParams.get('code');
  const exchanged = await fetch(`${firstBase}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, code_verifier: verifier,
      client_id: registration.client_id, redirect_uri: redirectUri, resource: config.publicUrl,
    }),
  });
  assert.equal(exchanged.status, 200);
  const tokens = await exchanged.json();
  await new Promise((resolve) => firstServer.close(resolve));

  const restartedServer = createHttpServer(config);
  t.after(() => new Promise((resolve) => restartedServer.close(resolve)));
  const restartedBase = await listen(restartedServer);
  const refreshed = await fetch(`${restartedBase}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
      client_id: registration.client_id, resource: config.publicUrl,
    }),
  });

  assert.equal(refreshed.status, 200);
  const payload = await refreshed.json();
  assert.equal(payload.token_type, 'Bearer');
  assert.ok(payload.access_token);
  assert.ok(payload.refresh_token);
  assert.deepEqual(events, [
    '[oauth] authorization_succeeded',
    '[oauth] token_succeeded grant_type=authorization_code',
    '[oauth] token_succeeded grant_type=refresh_token',
  ]);
});

test('HTTP keeps update previews across stateless MCP requests', async (t) => {
  const priorAllowInsecure = process.env.ALLOW_INSECURE_NO_AUTH;
  const priorToken = process.env.MONEYLOVER_ACCESS_TOKEN;
  const priorFetch = global.fetch;
  process.env.ALLOW_INSECURE_NO_AUTH = 'true';
  process.env.MONEYLOVER_ACCESS_TOKEN = fakeJwt();

  let editCalls = 0;
  let current = {
    _id: 'tx-1', account: { _id: 'wallet-1' }, amount: -100, note: 'test',
    displayDate: '2026-09-15T00:00:00.000Z', with: [], campaign: [], exclude_report: false,
    longtitude: 0, latitude: 0, address: '', images: [],
    category: { _id: 'runtime-shopping', name: 'Mua sắm', categories: ['source-shopping'] },
  };
  const observedFamily = {
    _id: 'tx-family', account: { _id: 'wallet-1' }, amount: -1, note: 'mapping',
    displayDate: '2026-09-01T00:00:00.000Z', with: [], campaign: [], exclude_report: false,
    longtitude: 0, latitude: 0, address: '', images: [],
    category: { _id: 'runtime-family', name: 'Gia đình', categories: ['source-family'] },
  };
  global.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === '127.0.0.1') return priorFetch(url, init);
    if (parsed.pathname.endsWith('/user/info')) return jsonResponse({ error: 0, data: { _id: 'user-1', tags: ['user_category_v2'] } });
    if (parsed.pathname.endsWith('/wallet/list')) return jsonResponse({ error: 0, data: [{ _id: 'wallet-1', owner: 'user-1', name: 'Tiền mặt' }] });
    if (parsed.pathname.endsWith('/category/list')) return jsonResponse({ error: 0, data: [{ _id: 'source-family', name: 'Gia đình', type: 2 }] });
    if (parsed.pathname.endsWith('/transaction/list')) return jsonResponse({ error: 0, data: { transactions: [current, observedFamily] } });
    if (parsed.pathname.endsWith('/transaction/edit')) {
      editCalls += 1;
      const body = JSON.parse(init.body);
      current = { ...current, category: { _id: body.category, name: 'Gia đình', categories: ['source-family'] } };
      return jsonResponse({ error: 0, data: current });
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };

  const server = createHttpServer({ authMode: 'none' });
  const base = await listen(server);
  const client = new Client({ name: 'http-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
  await client.connect(transport);

  t.after(async () => {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
    global.fetch = priorFetch;
    if (priorAllowInsecure === undefined) delete process.env.ALLOW_INSECURE_NO_AUTH;
    else process.env.ALLOW_INSECURE_NO_AUTH = priorAllowInsecure;
    if (priorToken === undefined) delete process.env.MONEYLOVER_ACCESS_TOKEN;
    else process.env.MONEYLOVER_ACCESS_TOKEN = priorToken;
  });

  const previewResponse = await client.callTool({
    name: 'preview_update_transaction',
    arguments: { walletId: 'wallet-1', transactionId: 'tx-1', date: '2026-09-15', categoryName: 'Gia đình' },
  });
  const preview = previewResponse.structuredContent.result;
  const updateResponse = await client.callTool({
    name: 'update_transaction', arguments: { previewId: preview.previewId, confirmation: 'UPDATE' },
  });

  assert.equal(updateResponse.structuredContent.result.result.updated, true);
  assert.equal(updateResponse.structuredContent.result.result.transaction.category, 'Gia đình');
  assert.equal(editCalls, 1);
});
