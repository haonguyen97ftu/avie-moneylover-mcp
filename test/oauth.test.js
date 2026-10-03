import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { SingleUserOAuth } from '../src/oauth.js';

const oauth = () => new SingleUserOAuth({
  publicUrl: 'https://mcp.example.test',
  secret: '0123456789abcdef0123456789abcdef',
  ownerPassword: 'a-very-long-owner-password',
});

test('OAuth authorization code uses PKCE and cannot be replayed', () => {
  const server = oauth();
  const registered = server.registerClient({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector/callback'] });
  const verifier = 'a'.repeat(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({
    response_type: 'code', client_id: registered.client_id,
    redirect_uri: 'https://chatgpt.com/connector/callback', code_challenge_method: 'S256', code_challenge: challenge,
    resource: 'https://mcp.example.test',
  });
  const code = server.issueAuthorizationCode(params, 'a-very-long-owner-password');
  const tokens = server.exchangeAuthorizationCode({ code, clientId: registered.client_id, redirectUri: 'https://chatgpt.com/connector/callback', codeVerifier: verifier, resource: 'https://mcp.example.test' });

  assert.equal(server.verifyAccessToken(tokens.access_token).sub, 'owner');
  assert.throws(() => server.exchangeAuthorizationCode({ code, clientId: registered.client_id, redirectUri: 'https://chatgpt.com/connector/callback', codeVerifier: verifier, resource: 'https://mcp.example.test' }), /already used/);

  const refreshed = server.refresh({ refreshToken: tokens.refresh_token, clientId: registered.client_id, resource: 'https://mcp.example.test' });
  assert.equal(server.verifyAccessToken(refreshed.access_token).aud, 'https://mcp.example.test');
  assert.equal(server.refresh({ refreshToken: tokens.refresh_token, clientId: registered.client_id, resource: 'https://mcp.example.test' }).token_type, 'Bearer');

  const restartedServer = oauth();
  const afterRestart = restartedServer.refresh({
    refreshToken: refreshed.refresh_token,
    clientId: registered.client_id,
    resource: 'https://mcp.example.test',
  });
  assert.equal(restartedServer.verifyAccessToken(afterRestart.access_token).aud, 'https://mcp.example.test');
});

test('OAuth refresh token remains bound to its client and resource', () => {
  const server = oauth();
  const registered = server.registerClient({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector/callback'] });
  const tokens = server.issueTokens(registered.client_id, undefined, 'https://mcp.example.test');

  assert.throws(() => server.refresh({
    refreshToken: tokens.refresh_token,
    clientId: 'different-client',
    resource: 'https://mcp.example.test',
  }), /client mismatch/);
  assert.throws(() => server.refresh({
    refreshToken: tokens.refresh_token,
    clientId: registered.client_id,
    resource: 'https://other.example.test',
  }), /resource mismatch/);
});

test('OAuth rejects wrong owner password and non-HTTPS redirect', () => {
  const server = oauth();
  assert.throws(() => server.registerClient({ redirect_uris: ['http://evil.example/callback'] }), /HTTPS/);
  const client = server.registerClient({ redirect_uris: ['https://chatgpt.com/connector/callback'] });
  const params = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: 'https://chatgpt.com/connector/callback',
    code_challenge_method: 'S256', code_challenge: 'challenge', resource: 'https://mcp.example.test',
  });
  assert.throws(() => server.issueAuthorizationCode(params, 'wrong-password'), /Incorrect owner password/);
});
