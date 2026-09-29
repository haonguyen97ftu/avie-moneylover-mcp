import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const READ_SCOPE = 'moneylover:read';
const WRITE_SCOPE = 'moneylover:write';
const DEFAULT_SCOPES = `${READ_SCOPE} ${WRITE_SCOPE}`;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function parseBase64urlJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function readForm(req, maxBytes = 32_768) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function html(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

export class SingleUserOAuth {
  constructor({ publicUrl, secret, ownerPassword, now = () => Date.now(), logger = console } = {}) {
    this.publicUrl = String(publicUrl ?? '').replace(/\/$/, '');
    this.secret = String(secret ?? '');
    // Railway's variable UI and mobile password managers can add surrounding
    // whitespace while copying. Owner passwords never intentionally depend on
    // leading/trailing whitespace, so normalize both sides of the comparison.
    this.ownerPassword = String(ownerPassword ?? '').trim();
    this.now = now;
    this.logger = logger;
    this.issuedAuthorizationCodes = new Map();
    this.activeRefreshTokens = new Map();
    this.failedAuthorizationAttempts = [];

    let parsedPublicUrl;
    try { parsedPublicUrl = new URL(this.publicUrl); } catch { throw new Error('MCP_PUBLIC_URL must be a valid URL.'); }
    const isLocal = parsedPublicUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsedPublicUrl.hostname);
    if ((parsedPublicUrl.protocol !== 'https:' && !isLocal) || parsedPublicUrl.origin !== this.publicUrl) {
      throw new Error('MCP_PUBLIC_URL must be an HTTPS origin with no path (or a localhost HTTP origin for tests).');
    }
    if (this.secret.length < 32) throw new Error('MCP_AUTH_SECRET must be at least 32 characters.');
    if (this.ownerPassword.length < 12) throw new Error('MCP_OWNER_PASSWORD must be at least 12 characters.');
  }

  sign(kind, payload, ttlSeconds) {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const nowSeconds = Math.floor(this.now() / 1000);
    const body = base64url(JSON.stringify({
      ...payload,
      kind,
      iat: nowSeconds,
      exp: nowSeconds + ttlSeconds,
      iss: this.publicUrl,
    }));
    const signature = createHmac('sha256', this.secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  verify(token, expectedKind) {
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const expected = createHmac('sha256', this.secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');
    if (!secureEqual(expected, parts[2])) throw new Error('Invalid token signature');
    const payload = parseBase64urlJson(parts[1]);
    if (payload.iss !== this.publicUrl) throw new Error('Invalid token issuer');
    if (payload.kind !== expectedKind) throw new Error('Invalid token type');
    if (!payload.exp || payload.exp <= Math.floor(this.now() / 1000)) throw new Error('Token expired');
    return payload;
  }

  registerClient(metadata) {
    const redirectUris = Array.isArray(metadata?.redirect_uris) ? metadata.redirect_uris : [];
    if (!redirectUris.length || redirectUris.some((uri) => {
      try {
        const parsed = new URL(uri);
        return parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
      } catch { return true; }
    })) {
      throw new Error('redirect_uris must contain HTTPS URLs');
    }
    const payload = {
      redirect_uris: redirectUris,
      client_name: String(metadata?.client_name ?? 'ChatGPT'),
      token_endpoint_auth_method: 'none',
    };
    const clientId = this.sign('client', payload, 100 * 365 * 24 * 60 * 60);
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(this.now() / 1000),
      client_name: payload.client_name,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  validateAuthorization(params) {
    if (params.get('response_type') !== 'code') throw new Error('response_type must be code');
    const clientId = params.get('client_id');
    const client = this.verify(clientId, 'client');
    const redirectUri = params.get('redirect_uri');
    if (!client.redirect_uris.includes(redirectUri)) throw new Error('redirect_uri is not registered');
    if (params.get('code_challenge_method') !== 'S256') throw new Error('PKCE S256 is required');
    if (!params.get('code_challenge')) throw new Error('code_challenge is required');
    if (params.get('resource') !== this.publicUrl) throw new Error('resource must match this MCP server');
    const scopes = (params.get('scope') || DEFAULT_SCOPES).split(/\s+/).filter(Boolean);
    if (scopes.some((scope) => ![READ_SCOPE, WRITE_SCOPE].includes(scope))) throw new Error('Unsupported OAuth scope');
    return { clientId, client, redirectUri };
  }

  issueAuthorizationCode(params, password) {
    const cutoff = this.now() - 15 * 60 * 1000;
    this.failedAuthorizationAttempts = this.failedAuthorizationAttempts.filter((attempt) => attempt > cutoff);
    if (this.failedAuthorizationAttempts.length >= 10) throw new Error('Too many authorization attempts. Try again in 15 minutes.');
    if (!secureEqual(String(password ?? '').trim(), this.ownerPassword)) {
      this.failedAuthorizationAttempts.push(this.now());
      throw new Error('Incorrect owner password');
    }
    this.failedAuthorizationAttempts = [];
    const { clientId, redirectUri } = this.validateAuthorization(params);
    const jti = randomUUID();
    const code = this.sign('authorization_code', {
      jti,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: params.get('code_challenge'),
      resource: params.get('resource'),
      scope: params.get('scope') || DEFAULT_SCOPES,
    }, 300);
    this.issuedAuthorizationCodes.set(jti, Math.floor(this.now() / 1000) + 300);
    this.cleanupTokens();
    return code;
  }

  exchangeAuthorizationCode({ code, clientId, redirectUri, codeVerifier, resource }) {
    const payload = this.verify(code, 'authorization_code');
    if (!this.issuedAuthorizationCodes.has(payload.jti)) throw new Error('Authorization code already used, expired, or invalidated by a restart');
    if (payload.client_id !== clientId || payload.redirect_uri !== redirectUri) {
      throw new Error('Authorization code client or redirect mismatch');
    }
    if (payload.resource !== resource || resource !== this.publicUrl) throw new Error('Authorization code resource mismatch');
    const challenge = createHash('sha256').update(String(codeVerifier ?? '')).digest('base64url');
    if (!secureEqual(challenge, payload.code_challenge)) throw new Error('PKCE verification failed');
    this.issuedAuthorizationCodes.delete(payload.jti);
    this.cleanupTokens();
    return this.issueTokens(clientId, payload.scope, resource);
  }

  refresh({ refreshToken, clientId, resource }) {
    const payload = this.verify(refreshToken, 'refresh_token');
    if (payload.client_id !== clientId) throw new Error('Refresh token client mismatch');
    if (payload.aud !== resource || resource !== this.publicUrl) throw new Error('Refresh token resource mismatch');
    if (this.activeRefreshTokens.get(clientId) !== payload.jti) throw new Error('Refresh token already used or invalidated by a restart');
    this.cleanupTokens();
    return this.issueTokens(clientId, payload.scope, resource);
  }

  issueTokens(clientId, scope = DEFAULT_SCOPES, resource = this.publicUrl) {
    const refreshJti = randomUUID();
    this.activeRefreshTokens.set(clientId, refreshJti);
    return {
      token_type: 'Bearer',
      access_token: this.sign('access_token', { sub: 'owner', client_id: clientId, scope, aud: resource }, 3600),
      expires_in: 3600,
      refresh_token: this.sign('refresh_token', { sub: 'owner', client_id: clientId, scope, aud: resource, jti: refreshJti }, 30 * 24 * 60 * 60),
      scope,
    };
  }

  verifyAccessToken(token) {
    const payload = this.verify(token, 'access_token');
    if (payload.aud !== this.publicUrl) throw new Error('Invalid token audience');
    return payload;
  }

  cleanupTokens() {
    const nowSeconds = Math.floor(this.now() / 1000);
    for (const [jti, exp] of this.issuedAuthorizationCodes) if (exp <= nowSeconds) this.issuedAuthorizationCodes.delete(jti);
  }

  protectedResourceMetadata() {
    return {
      resource: this.publicUrl,
      authorization_servers: [this.publicUrl],
      scopes_supported: [READ_SCOPE, WRITE_SCOPE],
      resource_documentation: `${this.publicUrl}/`,
    };
  }

  authorizationServerMetadata() {
    return {
      issuer: this.publicUrl,
      authorization_response_iss_parameter_supported: true,
      authorization_endpoint: `${this.publicUrl}/oauth/authorize`,
      token_endpoint: `${this.publicUrl}/oauth/token`,
      registration_endpoint: `${this.publicUrl}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [READ_SCOPE, WRITE_SCOPE],
    };
  }

  redirectAuthorizationResponse(res, redirectUri, params) {
    const redirect = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
      if (value) redirect.searchParams.set(key, value);
    }
    redirect.searchParams.set('iss', this.publicUrl);
    res.writeHead(302, {
      Location: redirect.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    res.end();
  }

  renderAuthorizationForm(res, params, { status = 200, error = null } = {}) {
    const { client, redirectUri } = this.validateAuthorization(params);
    const fields = [...params.entries()]
      .filter(([key]) => key !== 'owner_password')
      .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
      .join('\n');
    const errorMessage = error
      ? `<div class="error" role="alert">${escapeHtml(error)}</div>`
      : '';
    html(res, status, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Money Lover</title><style>body{font-family:system-ui;max-width:420px;margin:48px auto;padding:0 20px;color:#172033}label,input,button{display:block;width:100%;box-sizing:border-box}input{padding:12px;margin:8px 0 18px;border:1px solid #ccd2dc;border-radius:10px}button{padding:12px;border:0;border-radius:10px;background:#137333;color:white;font-weight:700}.note{color:#596579;font-size:14px}.error{margin:16px 0;padding:12px;border-radius:10px;background:#fff1f0;color:#a61b1b;font-weight:650}</style></head><body><h1>Connect Avie Money Lover</h1><p><strong>${escapeHtml(client.client_name)}</strong> requests read and confirmed-write access to your private Money Lover connector.</p><p class="note">After approval, the browser returns to ${escapeHtml(new URL(redirectUri).hostname)}.</p>${errorMessage}<form method="post" action="${escapeHtml(`${this.publicUrl}/oauth/authorize`)}">${fields}<label>Owner password<input name="owner_password" type="password" required autocomplete="current-password" autocapitalize="none" spellcheck="false" enterkeyhint="go"></label><button type="submit">Authorize</button></form><p class="note">Paste the exact <strong>MCP_OWNER_PASSWORD</strong> value from Railway Variables. This is not your Money Lover or ChatGPT password.</p></body></html>`);
  }

  challengeHeader() {
    return `Bearer resource_metadata="${this.publicUrl}/.well-known/oauth-protected-resource", scope="${DEFAULT_SCOPES}"`;
  }

  async handleHttp(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
      json(res, 200, this.protectedResourceMetadata());
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      json(res, 200, this.authorizationServerMetadata());
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/oauth/register') {
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32_768) throw new Error('Registration request body too large');
          chunks.push(chunk);
        }
        const metadata = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        json(res, 201, this.registerClient(metadata));
      } catch (error) {
        json(res, 400, { error: 'invalid_client_metadata', error_description: error.message });
      }
      return true;
    }
    if (url.pathname === '/oauth/authorize' && req.method === 'GET') {
      try {
        this.renderAuthorizationForm(res, url.searchParams);
      } catch (error) {
        html(res, 400, `<h1>Invalid authorization request</h1><p>${escapeHtml(error.message)}</p>`);
      }
      return true;
    }
    if (url.pathname === '/oauth/authorize' && req.method === 'POST') {
      let form;
      try {
        form = await readForm(req);
        const code = this.issueAuthorizationCode(form, form.get('owner_password'));
        this.logger.info?.('[oauth] authorization_succeeded');
        this.redirectAuthorizationResponse(res, form.get('redirect_uri'), {
          code,
          state: form.get('state'),
        });
      } catch (error) {
        const reason = error.message === 'Incorrect owner password'
          ? 'incorrect_password'
          : error.message.startsWith('Too many authorization attempts')
            ? 'rate_limited'
            : 'invalid_request';
        this.logger.warn?.(`[oauth] authorization_failed reason=${reason}`);
        try {
          if (!form) throw error;
          this.validateAuthorization(form);
          const message = reason === 'incorrect_password'
            ? 'Incorrect owner password. Copy MCP_OWNER_PASSWORD from Railway Variables and try again.'
            : reason === 'rate_limited'
              ? 'Too many incorrect attempts. Wait 15 minutes and try again.'
              : 'The authorization request is invalid or expired. Return to ChatGPT and connect again.';
          this.renderAuthorizationForm(res, form, { status: reason === 'rate_limited' ? 429 : 401, error: message });
        } catch {
          html(res, 400, '<h1>Authorization failed</h1><p>The authorization request is invalid or expired. Return to ChatGPT and connect again.</p>');
        }
      }
      return true;
    }
    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      try {
        const form = await readForm(req);
        let tokens;
        if (form.get('grant_type') === 'authorization_code') {
          tokens = this.exchangeAuthorizationCode({
            code: form.get('code'),
            clientId: form.get('client_id'),
            redirectUri: form.get('redirect_uri'),
            codeVerifier: form.get('code_verifier'),
            resource: form.get('resource'),
          });
        } else if (form.get('grant_type') === 'refresh_token') {
          tokens = this.refresh({
            refreshToken: form.get('refresh_token'),
            clientId: form.get('client_id'),
            resource: form.get('resource'),
          });
        } else {
          throw new Error('Unsupported grant_type');
        }
        json(res, 200, tokens);
      } catch (error) {
        json(res, 400, { error: 'invalid_grant', error_description: error.message });
      }
      return true;
    }
    return false;
  }
}

export { DEFAULT_SCOPES, READ_SCOPE, WRITE_SCOPE };
