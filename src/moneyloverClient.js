// Private/unofficial Money Lover web API client.
// Observed against the current web app on 2026-08-22.
// Money Lover does not publish this API; endpoints and anti-bot requirements may change.

const BASE_ORIGIN = 'https://web.moneylover.me';
const BASE_URL = `${BASE_ORIGIN}/api`;
const LOGIN_URL = `${BASE_URL}/user/login-url`;
const TOKEN_URL = 'https://oauth.moneylover.me/token';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const DEBUG = process.env.DEBUG_MONEYLOVER === '1';

function debugLog(label, payload) {
  if (!DEBUG) return;
  try { console.error(`[moneylover-debug] ${label}:`, JSON.stringify(payload, null, 2)); }
  catch { console.error(`[moneylover-debug] ${label}:`, payload); }
}

class MoneyloverApiError extends Error {
  constructor(message, { code, detail, httpStatus } = {}) {
    super(message);
    this.name = 'MoneyloverApiError';
    this.code = code ?? null;
    this.httpStatus = httpStatus ?? null;
    if (detail) this.detail = detail;
  }
}

function ensureString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

function ensureDateString(date) {
  if (!date) throw new Error('date is required');
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) throw new Error('date is invalid');
    return date.toISOString().slice(0, 10);
  }
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return date.trim();
  throw new Error('date must be in YYYY-MM-DD format');
}

function normalizeWith(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  throw new Error('with must be a string or array of strings');
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (error) {
    throw new Error(`Failed to parse JSON response (HTTP ${response.status}): ${error.message}. Raw body: ${text.slice(0, 500)}`);
  }
}

function parseApiPayload(payload) {
  const errorCode = payload?.error ?? payload?.e ?? 0;
  if (errorCode && errorCode !== 0) {
    throw new MoneyloverApiError(payload?.msg || payload?.message || 'Money Lover API error', {
      code: errorCode,
      detail: payload,
    });
  }
  return payload?.data ?? null;
}

function isJwtExpired(token, skewSeconds = 60) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return Boolean(payload?.exp && payload.exp <= Math.floor(Date.now() / 1000) + skewSeconds);
  } catch { return false; }
}

function envBrowserCookie() {
  if (process.env.MONEYLOVER_COOKIE?.trim()) return process.env.MONEYLOVER_COOKIE.trim();
  if (process.env.MONEYLOVER_CF_CLEARANCE?.trim()) {
    return `cf_clearance=${process.env.MONEYLOVER_CF_CLEARANCE.trim()}`;
  }
  return '';
}

function daysAgoIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export class MoneyloverClient {
  constructor(token, options = {}) {
    this.token = ensureString(token, 'token');
    if (isJwtExpired(this.token)) throw new MoneyloverApiError('Money Lover access token is expired or about to expire');

    this.browserCookie = options.browserCookie ?? envBrowserCookie();
    this.userAgent = options.userAgent ?? process.env.MONEYLOVER_USER_AGENT ?? DEFAULT_UA;
    this.requestTimeoutMs = Number(options.requestTimeoutMs ?? process.env.MONEYLOVER_TIMEOUT_MS ?? 20000);
    this.categoryLookbackDays = Number(options.categoryLookbackDays ?? process.env.MONEYLOVER_CATEGORY_LOOKBACK_DAYS ?? 730);
  }

  static async getToken(email, password) {
    email = ensureString(email, 'email');
    password = ensureString(password, 'password');

    const loginResponse = await fetch(LOGIN_URL, { method: 'POST' });
    const loginPayload = await readJson(loginResponse);
    if (!loginResponse.ok) throw new MoneyloverApiError(`Failed to initiate login: HTTP ${loginResponse.status}`, { detail: loginPayload, httpStatus: loginResponse.status });

    const requestToken = loginPayload?.data?.request_token;
    const loginUrl = loginPayload?.data?.login_url;
    if (!requestToken || !loginUrl) throw new MoneyloverApiError('Login response missing request_token or login_url', { detail: loginPayload });

    let clientParam = '';
    try { clientParam = new URL(loginUrl).searchParams.get('client') || ''; } catch {}
    if (!clientParam) throw new Error('Unable to parse client from Money Lover login URL');

    const form = new URLSearchParams({ email, password });
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requestToken}`,
        Client: clientParam,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const tokenPayload = await readJson(tokenResponse);
    if (!tokenResponse.ok) throw new MoneyloverApiError(`Failed to exchange credentials for token: HTTP ${tokenResponse.status}`, { detail: tokenPayload, httpStatus: tokenResponse.status });
    const accessToken = tokenPayload?.access_token || tokenPayload?.data?.access_token || tokenPayload?.token;
    if (!accessToken) throw new MoneyloverApiError('Access token not present in response', { detail: tokenPayload });
    return accessToken;
  }

  async #request(path, { body, form, browserWrite = false, walletId } = {}) {
    const url = `${BASE_URL}${path}`;
    const headers = {
      Authorization: `AuthJWT ${this.token}`,
      'Cache-Control': 'no-cache, max-age=0, no-store, no-transform, must-revalidate',
    };

    let requestBody;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      requestBody = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    if (browserWrite) {
      headers.Accept = 'application/json';
      headers.dataformat = 'json';
      headers.Origin = BASE_ORIGIN;
      headers.Referer = `${BASE_ORIGIN}/wallet/${ensureString(walletId, 'walletId')}`;
      headers['User-Agent'] = this.userAgent;
      if (this.browserCookie) headers.Cookie = this.browserCookie;
    }

    debugLog(`POST ${path} request`, {
      url,
      headers: {
        ...headers,
        Authorization: 'AuthJWT [redacted]',
        Cookie: headers.Cookie ? '[redacted]' : undefined,
      },
      body: form ?? body ?? null,
    });

    let response;
    try {
      response = await fetch(url, {
        method: 'POST', headers, body: requestBody,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new MoneyloverApiError(`Timed out calling ${path} after ${this.requestTimeoutMs}ms`, {
          detail: browserWrite && !this.browserCookie
            ? { hint: 'transaction/add may require the current browser cf_clearance cookie and matching User-Agent' }
            : undefined,
        });
      }
      throw error;
    }

    const payload = await readJson(response);
    debugLog(`POST ${path} response`, { status: response.status, payload });
    if (!response.ok) throw new MoneyloverApiError(`HTTP ${response.status} calling ${path}`, { detail: payload, httpStatus: response.status });
    return parseApiPayload(payload);
  }

  getBrowserWriteStatus() {
    return {
      cookieConfigured: Boolean(this.browserCookie),
      userAgentConfigured: Boolean(this.userAgent),
      requestTimeoutMs: this.requestTimeoutMs,
      categoryLookbackDays: this.categoryLookbackDays,
    };
  }

  async getUserInfo() { return this.#request('/user/info'); }
  async getWallets() { return this.#request('/wallet/list'); }

  async getCategories(walletId) {
    walletId = ensureString(walletId, 'walletId');
    return this.#request('/category/list', { form: { walletId } });
  }

  async getTransactions(walletId, startDate, endDate) {
    walletId = ensureString(walletId, 'walletId');
    startDate = ensureDateString(startDate);
    endDate = ensureDateString(endDate);
    return this.#request('/transaction/list', { body: { walletId, startDate, endDate } });
  }

  async resolveListCategory(walletId, { categoryId, categoryName } = {}) {
    walletId = ensureString(walletId, 'walletId');
    const categories = await this.getCategories(walletId);
    if (categoryId) {
      const wanted = ensureString(categoryId, 'categoryId');
      const found = categories.find((c) => c?._id === wanted || c?.id === wanted);
      if (!found) throw new Error(`Category ${wanted} does not belong to wallet ${walletId}`);
      return found;
    }
    const name = ensureString(categoryName, 'categoryName');
    const normalize = (v) => String(v ?? '').trim().toLocaleLowerCase('vi-VN');
    const matches = categories.filter((c) => normalize(c?.name) === normalize(name));
    if (matches.length === 0) throw new Error(`No category named "${name}" found in wallet ${walletId}`);
    if (matches.length > 1) throw new Error(`Multiple categories named "${name}" found; use categoryId instead`);
    return matches[0];
  }

  async buildRuntimeCategoryMap(walletId, { startDate, endDate } = {}) {
    walletId = ensureString(walletId, 'walletId');
    startDate = startDate ? ensureDateString(startDate) : daysAgoIso(this.categoryLookbackDays);
    endDate = endDate ? ensureDateString(endDate) : new Date().toISOString().slice(0, 10);
    const data = await this.getTransactions(walletId, startDate, endDate);
    const transactions = data?.transactions ?? [];
    const map = new Map();

    for (const tx of transactions) {
      const runtimeId = tx?.category?._id;
      if (!runtimeId) continue;
      const sourceIds = Array.isArray(tx?.category?.categories) ? tx.category.categories.filter(Boolean) : [];
      for (const sourceId of sourceIds) {
        if (!map.has(sourceId)) {
          map.set(sourceId, {
            sourceId,
            runtimeId,
            name: tx.category.name,
            metadata: tx.category.metadata ?? '',
            observedFromTransactionId: tx._id,
          });
        }
      }
    }
    return map;
  }

  async resolveWriteCategory(walletId, { categoryId, categoryName, runtimeCategoryId } = {}) {
    walletId = ensureString(walletId, 'walletId');
    if (runtimeCategoryId) {
      return {
        source: null,
        runtimeId: ensureString(runtimeCategoryId, 'runtimeCategoryId'),
        resolution: 'explicit_runtime_id',
      };
    }

    const source = await this.resolveListCategory(walletId, { categoryId, categoryName });
    const sourceId = source._id || source.id;
    const runtimeMap = await this.buildRuntimeCategoryMap(walletId);
    const mapped = runtimeMap.get(sourceId);
    if (mapped) return { source, runtimeId: mapped.runtimeId, resolution: 'observed_transaction_mapping', mapped };

    const user = await this.getUserInfo();
    const isCategoryV2 = Array.isArray(user?.tags) && user.tags.includes('user_category_v2');
    if (isCategoryV2) {
      throw new MoneyloverApiError(
        `No runtime category ID found for "${source.name}". This account uses user_category_v2. ` +
        'Use runtimeCategoryId from a real browser transaction request, or create/use this category once in the web app so it can be learned from transaction history.',
        { detail: { sourceCategoryId: sourceId, categoryName: source.name } }
      );
    }

    return { source, runtimeId: sourceId, resolution: 'legacy_category_id' };
  }

  async findDuplicateTransaction({ walletId, categoryId, runtimeCategoryId, amount, date, note = '' }) {
    walletId = ensureString(walletId, 'walletId');
    const displayDate = ensureDateString(date);
    const numericAmount = Number(amount);
    const data = await this.getTransactions(walletId, displayDate, displayDate);
    const transactions = data?.transactions ?? [];
    const norm = (v) => String(v ?? '').trim().toLocaleLowerCase('vi-VN');
    const wantedIds = new Set([categoryId, runtimeCategoryId].filter(Boolean));

    return transactions.find((tx) => {
      const txDate = String(tx?.displayDate ?? '').slice(0, 10);
      const txAmount = Number(tx?.amount);
      const txNote = norm(tx?.note);
      const txCategoryIds = new Set([
        tx?.category?._id,
        ...(Array.isArray(tx?.category?.categories) ? tx.category.categories : []),
      ].filter(Boolean));
      const categoryMatches = wantedIds.size === 0 || [...wantedIds].some((id) => txCategoryIds.has(id));
      return txDate === displayDate && txAmount === numericAmount && txNote === norm(note) && categoryMatches;
    }) ?? null;
  }

  async addTransaction({ walletId, categoryId, runtimeCategoryId, amount, date, note, with: withWhom }) {
    walletId = ensureString(walletId, 'walletId');
    const effectiveCategoryId = ensureString(runtimeCategoryId || categoryId, 'runtimeCategoryId/categoryId');
    if (amount === undefined || amount === null || amount === '') throw new Error('amount is required');
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('amount must be a positive number');
    const displayDate = ensureDateString(date);

    return this.#request('/transaction/add', {
      walletId,
      browserWrite: true,
      body: {
        with: normalizeWith(withWhom),
        account: walletId,
        category: effectiveCategoryId,
        amount: numericAmount,
        note: note ?? '',
        displayDate,
        event: '',
        exclude_report: false,
        longtitude: 0,
        latitude: 0,
        addressName: '',
        addressDetails: '',
        addressIcon: '',
        image: '',
      },
    });
  }

  async editTransaction({ walletId, transaction, runtimeCategoryId }) {
    walletId = ensureString(walletId, 'walletId');
    const id = ensureString(transaction?._id ?? transaction?.id, 'transactionId');
    const existingAccountId = transaction?.account?._id ?? transaction?.account?.id ?? transaction?.account;
    if (String(existingAccountId) !== walletId) throw new Error('transaction account does not match walletId');
    const category = ensureString(runtimeCategoryId, 'runtimeCategoryId');
    const numericAmount = Math.abs(Number(transaction?.amount));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('transaction amount must be a non-zero number');
    const rawDisplayDate = transaction?.displayDate ?? transaction?.date;
    const displayDate = ensureDateString(typeof rawDisplayDate === 'string' ? rawDisplayDate.slice(0, 10) : rawDisplayDate);

    let address = {};
    if (transaction?.address && typeof transaction.address === 'object') address = transaction.address;
    if (typeof transaction?.address === 'string' && transaction.address.trim()) {
      try { address = JSON.parse(transaction.address); } catch { throw new Error('transaction address is not valid JSON'); }
    }
    const event = transaction?.campaign?.[0]?._id ?? transaction?.event?._id ?? transaction?.event ?? '';
    const parent = transaction?.parent?._id ?? transaction?.parent;
    const body = {
      _id: id,
      with: normalizeWith(transaction?.with),
      account: walletId,
      category,
      amount: numericAmount,
      note: transaction?.note ?? '',
      displayDate,
      event,
      exclude_report: Boolean(transaction?.exclude_report),
      longtitude: transaction?.longtitude ?? 0,
      latitude: transaction?.latitude ?? 0,
      addressName: address?.name ?? '',
      addressDetails: address?.details ?? '',
      addressIcon: address?.icon ?? '',
      remind: transaction?.remind,
      image: transaction?.images?.[0] ?? transaction?.image ?? '',
    };
    if (parent) body.parent = parent;

    return this.#request('/transaction/edit', { walletId, browserWrite: true, body });
  }
}

export { MoneyloverApiError, isJwtExpired };
