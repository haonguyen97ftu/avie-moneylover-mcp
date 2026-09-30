import fs from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MoneyloverClient } from './moneyloverClient.js';
import { previewBatch, importBatch } from './batchWorkflow.js';
import { PreviewStore } from './previewStore.js';
import { readCachedToken, writeCachedToken, clearCachedToken } from './tokenCache.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BATCH_ROWS = 250;

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

function ok(result, summary = 'Done') {
  return {
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(result, null, 2)}` }],
    structuredContent: { result },
  };
}

function fail(error) {
  const message = String(error?.message ?? error ?? 'Unknown error').slice(0, 1000);
  return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] };
}

function insufficientScope(requiredScopes) {
  const publicUrl = String(process.env.MCP_PUBLIC_URL ?? '').replace(/\/$/, '');
  const challenge = `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Reconnect with the required Money Lover scope", scope="${requiredScopes.join(' ')}"`;
  return { isError: true, content: [{ type: 'text', text: 'Authorization does not include the scope required for this operation.' }], _meta: { 'mcp/www_authenticate': [challenge] } };
}

async function loadOptionalJson(path, fallback = {}) {
  if (!path) return fallback;
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Unable to read ${path}: ${error.message}`);
  }
}

async function resolveToken() {
  if (process.env.MONEYLOVER_ACCESS_TOKEN?.trim()) return process.env.MONEYLOVER_ACCESS_TOKEN.trim();
  const email = process.env.MONEYLOVER_EMAIL?.trim();
  const password = process.env.MONEYLOVER_PASSWORD;
  if (!email || !password) {
    throw new Error('Money Lover credentials are not configured on the server. Set MONEYLOVER_ACCESS_TOKEN or MONEYLOVER_EMAIL and MONEYLOVER_PASSWORD.');
  }
  const cached = await readCachedToken(email);
  if (cached) return cached;
  const token = await MoneyloverClient.getToken(email, password);
  await writeCachedToken(email, token);
  return token;
}

async function withClient(fn) {
  const email = process.env.MONEYLOVER_EMAIL?.trim();
  try { return await fn(new MoneyloverClient(await resolveToken())); }
  catch (error) {
    if (email && /unauth|expired|token/i.test(`${error?.message} ${error?.detail?.msg ?? ''}`)) {
      await clearCachedToken(email);
    }
    throw error;
  }
}

function assertDateRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== startDate || Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== endDate) {
    throw new Error('startDate and endDate must be real calendar dates');
  }
  if (start > end) throw new Error('startDate must not be after endDate');
  if ((end - start) / 86_400_000 > 366) throw new Error('Date range may not exceed 366 days');
}

async function assertWalletOwner(client, walletId) {
  const [user, wallets] = await Promise.all([client.getUserInfo(), client.getWallets()]);
  const wallet = (wallets ?? []).find((item) => item?._id === walletId || item?.id === walletId);
  if (!wallet) throw new Error(`Wallet ${walletId} is not accessible`);
  if (wallet.owner !== user?._id) throw new Error('Write blocked: authenticated user is not the wallet owner');
  return { user, wallet };
}

function compactTransaction(tx) {
  return {
    id: tx?._id ?? tx?.id ?? null,
    amount: tx?.amount ?? null,
    note: tx?.note ?? '',
    date: String(tx?.displayDate ?? tx?.date ?? '').slice(0, 10),
    category: tx?.category?.name ?? null,
  };
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function collectScalarPaths(value, prefix = '', depth = 0, result = []) {
  if (depth > 3 || value === null || value === undefined) return result;
  if (typeof value === 'string' || typeof value === 'number') {
    result.push({ path: prefix, value: String(value) });
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 3)) collectScalarPaths(item, `${prefix}[]`, depth + 1, result);
    return result;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectScalarPaths(item, prefix ? `${prefix}.${key}` : key, depth + 1, result);
    }
  }
  return result;
}

export function buildIdentityDiagnostics(user, wallet) {
  const walletOwner = wallet?.owner;
  const userId = user?._id;
  const userScalars = collectScalarPaths(user);
  const walletScalars = collectScalarPaths(wallet);
  return {
    currentRule: {
      walletPath: 'owner',
      userPath: '_id',
      walletType: valueType(walletOwner),
      userType: valueType(userId),
      matches: walletOwner === userId,
    },
    walletOwnerMatchesUserPaths: walletOwner === null || walletOwner === undefined
      ? []
      : userScalars.filter((entry) => entry.value === String(walletOwner)).map((entry) => entry.path),
    userIdMatchesWalletPaths: userId === null || userId === undefined
      ? []
      : walletScalars.filter((entry) => entry.value === String(userId)).map((entry) => entry.path),
    userFields: Object.fromEntries(Object.entries(user ?? {}).map(([key, value]) => [key, valueType(value)])),
    walletFields: Object.fromEntries(Object.entries(wallet ?? {}).map(([key, value]) => [key, valueType(value)])),
  };
}

const statementInput = {
  walletId: z.string().min(1),
  source: z.string().max(200).optional(),
  statement: z.object({
    expectedNet: z.number().optional(),
    statementBalance: z.number().optional(),
  }).passthrough().optional(),
  runtimeCategoryOverrides: z.object({
    byName: z.record(z.string()).optional(),
    bySourceId: z.record(z.string()).optional(),
  }).optional(),
  transactions: z.array(z.object({
    key: z.string().max(100).optional(),
    date: z.string().regex(DATE),
    postDate: z.string().regex(DATE).optional(),
    amount: z.number().positive(),
    direction: z.enum(['expense', 'income']).default('expense'),
    categoryName: z.string().min(1),
    merchant: z.string().max(300).optional(),
    note: z.string().max(1000).optional(),
    source: z.string().max(200).optional(),
    review: z.boolean().optional(),
  })).min(1).max(MAX_BATCH_ROWS),
};

export function createMoneyloverMcpServer({ previewStore = new PreviewStore() } = {}) {
  const server = new McpServer(
    { name: 'avie-moneylover-mcp', version: '1.1.0' },
    { instructions: 'Private Money Lover connector. Read freely. Preview every transaction or statement before writing. Never ask the user for secrets in chat. Only write after explicit confirmation.' }
  );

  const register = (name, config, handler) => {
    const requiredScopes = config.annotations?.readOnlyHint ? ['moneylover:read'] : ['moneylover:read', 'moneylover:write'];
    const securitySchemes = [{ type: 'oauth2', scopes: requiredScopes }];
    return server.registerTool(name, {
      ...config,
      outputSchema: { result: z.unknown() },
      _meta: { ...(config._meta ?? {}), securitySchemes },
    }, async (args, extra) => {
      const granted = extra?.authInfo?.scopes;
      if (Array.isArray(granted) && requiredScopes.some((scope) => !granted.includes(scope))) return insufficientScope(requiredScopes);
      try { return await handler(args); } catch (error) { return fail(error); }
    });
  };

  register('get_user_info', {
    title: 'Get Money Lover profile', description: 'Read the authenticated Money Lover profile.', inputSchema: {}, annotations: readAnnotations,
  }, async () => ok(await withClient(async (client) => {
    const user = await client.getUserInfo();
    return { id: user?._id ?? null, name: user?.name ?? user?.email ?? null, email: user?.email ?? null, categoryV2: user?.tags?.includes('user_category_v2') ?? false };
  }), 'Profile loaded'));

  register('get_wallets', {
    title: 'List wallets', description: 'List wallets accessible to the authenticated user.', inputSchema: {}, annotations: readAnnotations,
  }, async () => ok(await withClient(async (client) => (await client.getWallets() ?? []).map((wallet) => ({
    id: wallet?._id ?? wallet?.id, name: wallet?.name, currency: wallet?.currency?.code ?? wallet?.currency, balance: wallet?.balance, owner: wallet?.owner,
  }))), 'Wallets loaded'));

  register('get_categories', {
    title: 'List categories', description: 'List categories for one wallet.', inputSchema: { walletId: z.string().min(1) }, annotations: readAnnotations,
  }, async ({ walletId }) => ok(await withClient(async (client) => (await client.getCategories(walletId) ?? []).map((category) => ({
    id: category?._id ?? category?.id, name: category?.name, type: category?.type,
  }))), 'Categories loaded'));

  register('get_transactions', {
    title: 'Get transactions', description: 'Fetch transactions for one wallet over at most 366 days.', inputSchema: {
      walletId: z.string().min(1), startDate: z.string().regex(DATE), endDate: z.string().regex(DATE),
    }, annotations: readAnnotations,
  }, async ({ walletId, startDate, endDate }) => {
    assertDateRange(startDate, endDate);
    return ok(await withClient(async (client) => {
      const data = await client.getTransactions(walletId, startDate, endDate);
      return { walletId, startDate, endDate, transactions: (data?.transactions ?? []).map(compactTransaction) };
    }), 'Transactions loaded');
  });

  register('preview_transaction', {
    title: 'Preview transaction', description: 'Resolve a category and check duplicates without writing.', inputSchema: {
      walletId: z.string().min(1), categoryId: z.string().min(1).optional(), categoryName: z.string().min(1).optional(),
      runtimeCategoryId: z.string().min(1).optional(), amount: z.number().positive(), date: z.string().regex(DATE), note: z.string().max(1000).optional(),
    }, annotations: readAnnotations,
  }, async ({ walletId, categoryId, categoryName, runtimeCategoryId, amount, date, note }) => {
    if (!categoryId && !categoryName && !runtimeCategoryId) throw new Error('Provide categoryId, categoryName, or runtimeCategoryId');
    return ok(await withClient(async (client) => {
      const resolved = await client.resolveWriteCategory(walletId, { categoryId, categoryName, runtimeCategoryId });
      const sourceId = resolved.source?._id ?? resolved.source?.id ?? categoryId ?? null;
      const duplicate = await client.findDuplicateTransaction({ walletId, categoryId: sourceId, runtimeCategoryId: resolved.runtimeId, amount, date, note: note ?? '' });
      return { willWrite: false, walletId, category: { sourceId, runtimeId: resolved.runtimeId, name: resolved.source?.name ?? categoryName ?? null, resolution: resolved.resolution }, amount, date, note: note ?? '', duplicate: duplicate ? compactTransaction(duplicate) : null };
    }), 'Transaction preview ready');
  });

  register('add_transaction', {
    title: 'Add transaction', description: 'Create one transaction after explicit user approval. Blocks shared wallets and exact duplicates by default.', inputSchema: {
      walletId: z.string().min(1), categoryId: z.string().min(1).optional(), categoryName: z.string().min(1).optional(), runtimeCategoryId: z.string().min(1).optional(),
      amount: z.number().positive(), date: z.string().regex(DATE), note: z.string().max(1000).optional(), with: z.union([z.string(), z.array(z.string())]).optional(),
      confirmation: z.literal('ADD'), allowDuplicate: z.boolean().default(false),
    }, annotations: writeAnnotations,
  }, async ({ walletId, categoryId, categoryName, runtimeCategoryId, amount, date, note, with: withWhom, allowDuplicate }) => {
    if (!categoryId && !categoryName && !runtimeCategoryId) throw new Error('Provide categoryId, categoryName, or runtimeCategoryId');
    return ok(await withClient(async (client) => {
      await assertWalletOwner(client, walletId);
      const resolved = await client.resolveWriteCategory(walletId, { categoryId, categoryName, runtimeCategoryId });
      const sourceId = resolved.source?._id ?? resolved.source?.id ?? categoryId ?? null;
      if (!allowDuplicate) {
        const duplicate = await client.findDuplicateTransaction({ walletId, categoryId: sourceId, runtimeCategoryId: resolved.runtimeId, amount, date, note: note ?? '' });
        if (duplicate) return { created: false, reason: 'duplicate_detected', existingTransaction: compactTransaction(duplicate) };
      }
      const created = await client.addTransaction({ walletId, categoryId: sourceId, runtimeCategoryId: resolved.runtimeId, amount, date, note, with: withWhom });
      return { created: true, categoryResolution: resolved.resolution, transaction: compactTransaction(created) };
    }), 'Transaction write completed');
  });

  register('diagnose_write_context', {
    title: 'Diagnose write context', description: 'Read-only check of wallet ownership and browser-write configuration.', inputSchema: { walletId: z.string().min(1) }, annotations: readAnnotations,
  }, async ({ walletId }) => ok(await withClient(async (client) => {
    const [user, wallets] = await Promise.all([client.getUserInfo(), client.getWallets()]);
    const wallet = (wallets ?? []).find((item) => item?._id === walletId || item?.id === walletId);
    if (!wallet) throw new Error(`Wallet ${walletId} is not accessible`);
    return {
      categoryV2: user?.tags?.includes('user_category_v2') ?? false,
      wallet: { id: walletId, name: wallet.name, isOwner: wallet.owner === user?._id },
      identityDiagnostics: buildIdentityDiagnostics(user, wallet),
      browserWrite: client.getBrowserWriteStatus(),
    };
  }), 'Write context checked'));

  register('preview_statement', {
    title: 'Preview statement import', description: `Validate and reconcile up to ${MAX_BATCH_ROWS} transactions without writing.`, inputSchema: statementInput, annotations: readAnnotations,
  }, async (input) => {
    const [rulesConfig, runtimeOverrides] = await Promise.all([
      loadOptionalJson(process.env.MERCHANT_RULES_PATH, {}), loadOptionalJson(process.env.RUNTIME_CATEGORY_OVERRIDES_PATH, {}),
    ]);
    const preview = await withClient((client) => previewBatch(client, input, { rulesConfig, runtimeOverrides }));
    const stored = previewStore.create({ input, preview });
    return ok(stored, 'Statement preview ready. Review it, then call confirm_statement_import with confirmation IMPORT.');
  });

  register('confirm_statement_import', {
    title: 'Confirm statement import', description: 'Import the exact statement stored in a prior preview. Requires literal IMPORT and blocks unresolved/review/mismatch/shared-wallet cases.', inputSchema: {
      previewId: z.string().uuid(), confirmation: z.literal('IMPORT'),
    }, annotations: writeAnnotations,
  }, async ({ previewId, confirmation }) => {
    const entry = previewStore.startImport(previewId);
    try {
      const [rulesConfig, runtimeOverrides] = await Promise.all([
        loadOptionalJson(process.env.MERCHANT_RULES_PATH, {}), loadOptionalJson(process.env.RUNTIME_CATEGORY_OVERRIDES_PATH, {}),
      ]);
      const result = await withClient((client) => importBatch(client, entry.input, { confirmation, rulesConfig, runtimeOverrides }));
      return ok(previewStore.complete(previewId, result), 'Statement import completed');
    } catch (error) {
      previewStore.fail(previewId, error);
      throw error;
    }
  });

  register('get_import_status', {
    title: 'Get import status', description: 'Read the status of a statement preview/import.', inputSchema: { previewId: z.string().uuid() }, annotations: readAnnotations,
  }, async ({ previewId }) => ok(previewStore.publicView(previewStore.get(previewId)), 'Import status loaded'));

  return server;
}
