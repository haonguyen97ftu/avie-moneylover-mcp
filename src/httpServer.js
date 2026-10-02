import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMoneyloverMcpServer } from './mcpServer.js';
import { SingleUserOAuth } from './oauth.js';
import { PreviewStore } from './previewStore.js';
import { UpdatePreviewStore } from './updatePreviewStore.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  return match?.[1] ?? null;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON request body'), { statusCode: 400 }); }
}

export function createHttpServer({
  authMode = process.env.MCP_AUTH_MODE ?? 'oauth',
  publicUrl = process.env.MCP_PUBLIC_URL,
  authSecret = process.env.MCP_AUTH_SECRET,
  ownerPassword = process.env.MCP_OWNER_PASSWORD,
  previewStore = new PreviewStore(),
  updatePreviewStore = new UpdatePreviewStore(),
  logger = console,
} = {}) {
  if (!['oauth', 'none'].includes(authMode)) throw new Error('MCP_AUTH_MODE must be oauth or none');
  if (authMode === 'none' && process.env.ALLOW_INSECURE_NO_AUTH !== 'true') {
    throw new Error('Unauthenticated mode requires ALLOW_INSECURE_NO_AUTH=true and must only be used locally.');
  }
  const oauth = authMode === 'oauth' ? new SingleUserOAuth({ publicUrl, secret: authSecret, ownerPassword, logger }) : null;

  return http.createServer(async (req, res) => {
    const origin = publicUrl || `http://${req.headers.host || 'localhost'}`;
    const url = new URL(req.url ?? '/', origin);

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, service: 'avie-moneylover-mcp', version: '1.1.0' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/') {
        sendJson(res, 200, {
          name: 'Avie Money Lover MCP',
          mcpEndpoint: `${origin.replace(/\/$/, '')}/mcp`,
          authentication: authMode,
          warning: 'Private single-user connector. Do not share its owner password or Money Lover credentials.',
        });
        return;
      }
      if (oauth && await oauth.handleHttp(req, res, url)) return;
      if (url.pathname !== '/mcp') {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { Allow: 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS' });
        res.end();
        return;
      }
      if (!['POST', 'GET', 'DELETE'].includes(req.method ?? '')) {
        sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST, GET, DELETE, OPTIONS' });
        return;
      }

      let auth = { token: 'local-development', clientId: 'local', scopes: ['moneylover:read', 'moneylover:write'] };
      if (oauth) {
        const token = bearerToken(req);
        if (!token) {
          sendJson(res, 401, { error: 'unauthorized', error_description: 'Bearer token required' }, { 'WWW-Authenticate': oauth.challengeHeader() });
          return;
        }
        try {
          const claims = oauth.verifyAccessToken(token);
          auth = { token, clientId: claims.client_id, scopes: String(claims.scope ?? '').split(/\s+/).filter(Boolean), expiresAt: claims.exp, resource: new URL(publicUrl) };
        } catch (error) {
          sendJson(res, 401, { error: 'invalid_token', error_description: error.message }, { 'WWW-Authenticate': oauth.challengeHeader() });
          return;
        }
      }

      const parsedBody = req.method === 'POST' ? await readJsonBody(req) : undefined;
      req.auth = auth;
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const mcp = createMoneyloverMcpServer({ previewStore, updatePreviewStore });
      await mcp.connect(transport);
      try { await transport.handleRequest(req, res, parsedBody); }
      finally { await transport.close(); }
    } catch (error) {
      if (!res.headersSent) sendJson(res, error.statusCode ?? 500, { error: 'server_error', error_description: error.message });
      else if (!res.writableEnded) res.end();
    }
  });
}
