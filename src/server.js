#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MoneyloverClient } from './moneyloverClient.js';
import { readCachedToken, writeCachedToken, clearCachedToken } from './tokenCache.js';

const server = new McpServer({
  name: 'avie-moneylover-mcp',
  version: '1.0.0',
});

function formatSuccess(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function formatError(error) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Error: ${error.message}${
          error.detail ? `\nDetail: ${JSON.stringify(error.detail)}` : ''
        }`,
      },
    ],
  };
}

/**
 * Token precedence:
 * 1. Explicit tool argument (kept for compatibility/testing)
 * 2. MONEYLOVER_ACCESS_TOKEN env var (recommended for MCP clients)
 * 3. EMAIL/PASSWORD with per-email local cache
 */
async function resolveToken(explicitToken) {
  if (explicitToken) return explicitToken;

  const envToken = process.env.MONEYLOVER_ACCESS_TOKEN;
  if (envToken) return envToken;

  const email = process.env.MONEYLOVER_EMAIL || process.env.EMAIL;
  const password = process.env.MONEYLOVER_PASSWORD || process.env.PASSWORD;

  if (!email || !password) {
    throw new Error(
      'No Money Lover authentication configured. Set MONEYLOVER_ACCESS_TOKEN, or set ' +
        'MONEYLOVER_EMAIL and MONEYLOVER_PASSWORD in the MCP server environment.'
    );
  }

  const cached = await readCachedToken(email);
  if (cached) return cached;

  const token = await MoneyloverClient.getToken(email, password);
  await writeCachedToken(email, token);
  return token;
}

async function runWithClient(explicitToken, fn) {
  const token = await resolveToken(explicitToken);
  const client = new MoneyloverClient(token);
  try {
    return await fn(client);
  } catch (error) {
    const email = process.env.MONEYLOVER_EMAIL || process.env.EMAIL;
    if (email && /unauth|expired|token/i.test(`${error.message} ${error.detail?.msg ?? ''}`)) {
      await clearCachedToken(email);
    }
    throw error;
  }
}

server.registerTool(
  'login',
  {
    title: 'Login to Money Lover',
    description: 'Authenticate with Money Lover and return an access token.',
    inputSchema: {
      email: z.string().email().describe('Money Lover account email'),
      password: z.string().min(1).describe('Money Lover account password'),
    },
  },
  async ({ email, password }) => {
    try {
      const token = await MoneyloverClient.getToken(email, password);
      await writeCachedToken(email, token);
      return formatSuccess({ authenticated: true, tokenCached: true });
    } catch (error) {
      return formatError(error);
    }
  }
);

server.registerTool(
  'get_user_info',
  {
    title: 'Get Money Lover user info',
    description: 'Retrieve the authenticated Money Lover profile.',
    inputSchema: {
      token: z.string().optional().describe('Optional access token override'),
    },
  },
  async ({ token }) => {
    try {
      const data = await runWithClient(token, (client) => client.getUserInfo());
      return formatSuccess(data ?? {});
    } catch (error) {
      return formatError(error);
    }
  }
);

server.registerTool(
  'get_wallets',
  {
    title: 'List Money Lover wallets',
    description: 'List all wallets accessible to the authenticated user.',
    inputSchema: {
      token: z.string().optional().describe('Optional access token override'),
    },
  },
  async ({ token }) => {
    try {
      const data = await runWithClient(token, (client) => client.getWallets());
      return formatSuccess(data ?? []);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.registerTool(
  'get_categories',
  {
    title: 'List Money Lover categories',
    description: 'Retrieve categories for a specific wallet.',
    inputSchema: {
      walletId: z.string().min(1).describe('Wallet identifier'),
      token: z.string().optional().describe('Optional access token override'),
    },
  },
  async ({ walletId, token }) => {
    try {
      const data = await runWithClient(token, (client) => client.getCategories(walletId));
      return formatSuccess(data ?? []);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.registerTool(
  'get_transactions',
  {
    title: 'Get Money Lover transactions',
    description: 'Fetch transactions for a wallet between two dates.',
    inputSchema: {
      walletId: z.string().min(1).describe('Wallet identifier'),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date, YYYY-MM-DD'),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date, YYYY-MM-DD'),
      token: z.string().optional().describe('Optional access token override'),
    },
  },
  async ({ walletId, startDate, endDate, token }) => {
    try {
      const data = await runWithClient(token, (client) =>
        client.getTransactions(walletId, startDate, endDate)
      );
      return formatSuccess(data ?? { transactions: [] });
    } catch (error) {
      return formatError(error);
    }
  }
);

server.registerTool(
  'preview_transaction',
  {
    title: 'Preview a Money Lover transaction',
    description: 'Resolve a category and check for an exact duplicate without writing anything.',
    inputSchema: {
      walletId: z.string().min(1),
      categoryId: z.string().min(1).optional(),
      categoryName: z.string().min(1).optional(),
      runtimeCategoryId: z.string().min(1).optional().describe('Runtime category ID observed in a browser transaction request; useful for user_category_v2 accounts'),
      amount: z.union([z.number().positive(), z.string().min(1)]),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: z.string().optional(),
      token: z.string().optional(),
    },
  },
  async ({ walletId, categoryId, categoryName, runtimeCategoryId, amount, date, note, token }) => {
    try {
      if (!categoryId && !categoryName) throw new Error('Provide categoryId or categoryName');
      const data = await runWithClient(token, async (client) => {
        const resolved = await client.resolveWriteCategory(walletId, { categoryId, categoryName, runtimeCategoryId });
        const sourceId = resolved.source?._id || resolved.source?.id || categoryId || null;
        const duplicate = await client.findDuplicateTransaction({
          walletId,
          categoryId: sourceId,
          runtimeCategoryId: resolved.runtimeId,
          amount,
          date,
          note: note ?? '',
        });
        return {
          willWrite: false,
          walletId,
          category: {
            sourceId,
            runtimeId: resolved.runtimeId,
            name: resolved.source?.name ?? categoryName ?? null,
            type: resolved.source?.type ?? null,
            resolution: resolved.resolution,
          },
          amount: Number(amount),
          date,
          note: note ?? '',
          duplicate: duplicate ? { id: duplicate._id, amount: duplicate.amount, note: duplicate.note, displayDate: duplicate.displayDate } : null,
        };
      });
      return formatSuccess(data);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.registerTool(
  'add_transaction',
  {
    title: 'Add a Money Lover transaction',
    description: 'Create one transaction only after explicit confirmation. Validates category ownership and blocks exact duplicates by default.',
    inputSchema: {
      walletId: z.string().min(1).describe('Wallet identifier'),
      categoryId: z.string().min(1).optional().describe('Category ID from get_categories'),
      categoryName: z.string().min(1).optional().describe('Exact category name; resolved inside the wallet'),
      runtimeCategoryId: z.string().min(1).optional().describe('Runtime category ID from a real browser transaction request; overrides automatic mapping'),
      amount: z.union([z.number().positive(), z.string().min(1)]).describe('Transaction amount'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Transaction date, YYYY-MM-DD'),
      note: z.string().optional().describe('Optional note'),
      with: z.union([z.string(), z.array(z.string())]).optional(),
      confirmWrite: z.literal(true).describe('Must be true after the user has explicitly approved the write'),
      allowDuplicate: z.boolean().optional().default(false),
      token: z.string().optional(),
    },
  },
  async ({ walletId, categoryId, categoryName, runtimeCategoryId, amount, date, note, with: withWhom, allowDuplicate, token }) => {
    try {
      if (!categoryId && !categoryName && !runtimeCategoryId) throw new Error('Provide categoryId, categoryName, or runtimeCategoryId');
      const data = await runWithClient(token, async (client) => {
        const resolved = await client.resolveWriteCategory(walletId, { categoryId, categoryName, runtimeCategoryId });
        const sourceId = resolved.source?._id || resolved.source?.id || categoryId || null;
        const resolvedCategoryId = resolved.runtimeId;
        if (!allowDuplicate) {
          const duplicate = await client.findDuplicateTransaction({
            walletId, categoryId: sourceId, runtimeCategoryId: resolvedCategoryId, amount, date, note: note ?? '',
          });
          if (duplicate) {
            return {
              created: false,
              reason: 'duplicate_detected',
              existingTransaction: { id: duplicate._id, amount: duplicate.amount, note: duplicate.note, displayDate: duplicate.displayDate },
            };
          }
        }
        const created = await client.addTransaction({
          walletId, categoryId: sourceId, runtimeCategoryId: resolvedCategoryId, amount, date, note, with: withWhom,
        });
        return { created: true, categoryResolution: resolved.resolution, transaction: created };
      });
      return formatSuccess(data);
    } catch (error) {
      return formatError(error);
    }
  }
);

server.registerTool(
  'diagnose_write_context',
  {
    title: 'Diagnose Money Lover write context',
    description: 'Read-only diagnostics for wallet ownership, browser write config, and category-v2 runtime mapping.',
    inputSchema: {
      walletId: z.string().min(1),
      categoryId: z.string().min(1).optional(),
      categoryName: z.string().min(1).optional(),
      runtimeCategoryId: z.string().min(1).optional(),
      token: z.string().optional(),
    },
  },
  async ({ walletId, categoryId, categoryName, runtimeCategoryId, token }) => {
    try {
      const data = await runWithClient(token, async (client) => {
        const [user, wallets] = await Promise.all([client.getUserInfo(), client.getWallets()]);
        const wallet = (wallets ?? []).find((w) => w?._id === walletId);
        if (!wallet) throw new Error(`Wallet ${walletId} is not accessible`);

        let resolved = null;
        let categoryError = null;
        if (runtimeCategoryId || categoryId || categoryName) {
          try {
            resolved = await client.resolveWriteCategory(walletId, { categoryId, categoryName, runtimeCategoryId });
          } catch (error) {
            categoryError = { message: error.message, detail: error.detail ?? null };
          }
        }

        return {
          userId: user?._id ?? null,
          categoryV2: Array.isArray(user?.tags) && user.tags.includes('user_category_v2'),
          wallet: { id: wallet._id, name: wallet.name, owner: wallet.owner, isOwner: wallet.owner === user?._id },
          browserWrite: client.getBrowserWriteStatus(),
          resolved: resolved ? {
            sourceId: resolved.source?._id || resolved.source?.id || categoryId || null,
            sourceName: resolved.source?.name ?? categoryName ?? null,
            runtimeId: resolved.runtimeId,
            resolution: resolved.resolution,
          } : null,
          categoryError,
        };
      });
      return formatSuccess(data);
    } catch (error) {
      return formatError(error);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
