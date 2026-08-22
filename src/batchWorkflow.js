import fs from 'node:fs/promises';

const norm = (v) => String(v ?? '').trim().toLocaleLowerCase('vi-VN');
const dateOnly = (v) => String(v ?? '').slice(0, 10);

function toAmount(value, field = 'amount') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} must be a positive number`);
  return n;
}

function assertDate(value, field = 'date') {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${field} must be YYYY-MM-DD`);
  return s;
}

function sum(items, predicate) {
  return items.filter(predicate).reduce((acc, x) => acc + Number(x.amount || 0), 0);
}

export async function readJsonFile(path) {
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

export function applyMerchantRules(items, rulesConfig = {}) {
  const rules = Array.isArray(rulesConfig?.rules) ? rulesConfig.rules : [];
  return items.map((item) => {
    if (item.categoryName) return { ...item };
    const haystack = `${item.merchant ?? ''} ${item.note ?? ''}`.toLocaleUpperCase('vi-VN');
    const rule = rules.find((r) => {
      const contains = Array.isArray(r?.contains) ? r.contains : [];
      return contains.some((needle) => haystack.includes(String(needle).toLocaleUpperCase('vi-VN')));
    });
    return rule ? { ...item, categoryName: rule.categoryName, categoryRule: rule.name ?? rule.categoryName } : { ...item };
  });
}

export function normalizeBatchInput(input, rulesConfig = {}) {
  if (!input || typeof input !== 'object') throw new Error('Input JSON must be an object');
  const walletId = String(input.walletId || process.env.ML_WALLET_ID || '').trim();
  if (!walletId) throw new Error('walletId missing (set it in JSON or ML_WALLET_ID)');
  if (!Array.isArray(input.transactions) || input.transactions.length === 0) throw new Error('transactions must be a non-empty array');

  const withRules = applyMerchantRules(input.transactions, rulesConfig);
  const transactions = withRules.map((raw, index) => {
    const direction = raw.direction === 'income' ? 'income' : 'expense';
    const categoryName = String(raw.categoryName ?? '').trim();
    if (!categoryName) throw new Error(`transactions[${index}].categoryName missing and no merchant rule matched`);
    return {
      key: String(raw.key ?? `row-${index + 1}`),
      date: assertDate(raw.date, `transactions[${index}].date`),
      postDate: raw.postDate ? assertDate(raw.postDate, `transactions[${index}].postDate`) : null,
      amount: toAmount(raw.amount, `transactions[${index}].amount`),
      direction,
      categoryName,
      merchant: String(raw.merchant ?? '').trim(),
      note: String(raw.note ?? raw.merchant ?? '').trim(),
      source: String(raw.source ?? input.source ?? '').trim(),
      review: Boolean(raw.review),
    };
  });

  return {
    walletId,
    source: String(input.source ?? '').trim(),
    statement: input.statement ?? {},
    transactions,
    runtimeCategoryOverrides: input.runtimeCategoryOverrides ?? {},
  };
}

function findSourceCategory(categories, categoryName) {
  const matches = categories.filter((c) => norm(c?.name) === norm(categoryName));
  if (matches.length === 0) return { error: `Category "${categoryName}" not found` };
  if (matches.length > 1) return { error: `Multiple categories named "${categoryName}" found` };
  return { category: matches[0] };
}

function overrideRuntimeId(overrides, sourceCategory) {
  const byName = overrides?.byName ?? {};
  const bySourceId = overrides?.bySourceId ?? {};
  return bySourceId[sourceCategory?._id] || bySourceId[sourceCategory?.id] || byName[sourceCategory?.name] || null;
}

function txCategoryIds(tx) {
  return new Set([
    tx?.category?._id,
    ...(Array.isArray(tx?.category?.categories) ? tx.category.categories : []),
  ].filter(Boolean));
}

function duplicateMatches(existingTransactions, item, sourceId, runtimeId) {
  const sameDateAmount = existingTransactions.filter((tx) =>
    dateOnly(tx?.displayDate) === item.date && Number(tx?.amount) === item.amount
  );
  const wantedIds = new Set([sourceId, runtimeId].filter(Boolean));
  const exact = sameDateAmount.find((tx) => {
    const ids = txCategoryIds(tx);
    const catMatch = [...wantedIds].some((id) => ids.has(id));
    return catMatch && norm(tx?.note) === norm(item.note);
  }) ?? null;
  return { exact, probable: exact ? [] : sameDateAmount };
}

export async function previewBatch(client, rawInput, { rulesConfig = {}, runtimeOverrides = {} } = {}) {
  const input = normalizeBatchInput(rawInput, rulesConfig);
  const walletId = input.walletId;
  const dates = input.transactions.map((x) => x.date).sort();
  const startDate = dates[0];
  const endDate = dates.at(-1);

  const [user, wallets, categories, runtimeMap, txData] = await Promise.all([
    client.getUserInfo(),
    client.getWallets(),
    client.getCategories(walletId),
    client.buildRuntimeCategoryMap(walletId),
    client.getTransactions(walletId, startDate, endDate),
  ]);

  const wallet = (wallets ?? []).find((w) => w?._id === walletId);
  if (!wallet) throw new Error(`Wallet ${walletId} not found`);
  const categoryV2 = Array.isArray(user?.tags) && user.tags.includes('user_category_v2');
  const existingTransactions = txData?.transactions ?? [];
  const mergedOverrides = {
    byName: { ...(runtimeOverrides?.byName ?? {}), ...(input.runtimeCategoryOverrides?.byName ?? {}) },
    bySourceId: { ...(runtimeOverrides?.bySourceId ?? {}), ...(input.runtimeCategoryOverrides?.bySourceId ?? {}) },
  };

  const rows = input.transactions.map((item) => {
    const found = findSourceCategory(categories, item.categoryName);
    if (found.error) return { ...item, status: 'blocked', reason: 'category_not_found', detail: found.error };
    const sourceCategory = found.category;
    const expectedType = item.direction === 'income' ? 1 : 2;
    if (Number(sourceCategory.type) !== expectedType) {
      return {
        ...item, status: 'blocked', reason: 'category_direction_mismatch',
        detail: `${sourceCategory.name} has type ${sourceCategory.type}, expected ${expectedType} for ${item.direction}`,
        sourceCategoryId: sourceCategory._id || sourceCategory.id,
      };
    }

    const sourceId = sourceCategory._id || sourceCategory.id;
    const explicitRuntime = overrideRuntimeId(mergedOverrides, sourceCategory);
    const learned = runtimeMap.get(sourceId);
    const runtimeId = explicitRuntime || learned?.runtimeId || (!categoryV2 ? sourceId : null);
    const resolution = explicitRuntime ? 'override' : learned ? 'history' : (!categoryV2 ? 'legacy' : 'unresolved');
    if (!runtimeId) {
      return {
        ...item, status: 'blocked', reason: 'runtime_category_unresolved',
        detail: `No runtime category ID learned for "${sourceCategory.name}"`,
        sourceCategoryId: sourceId,
        runtimeCategoryId: null,
        categoryResolution: resolution,
      };
    }

    const dup = duplicateMatches(existingTransactions, item, sourceId, runtimeId);
    if (dup.exact) {
      return {
        ...item, status: 'skip', reason: 'exact_duplicate', sourceCategoryId: sourceId,
        runtimeCategoryId: runtimeId, categoryResolution: resolution,
        duplicate: { id: dup.exact._id, note: dup.exact.note, amount: dup.exact.amount, displayDate: dup.exact.displayDate },
      };
    }
    if (dup.probable.length) {
      return {
        ...item, status: 'review', reason: 'same_date_amount_exists', sourceCategoryId: sourceId,
        runtimeCategoryId: runtimeId, categoryResolution: resolution,
        possibleDuplicates: dup.probable.map((tx) => ({ id: tx._id, note: tx.note, amount: tx.amount, displayDate: tx.displayDate, category: tx?.category?.name })),
      };
    }

    return {
      ...item, status: item.review ? 'review' : 'ready', reason: item.review ? 'source_marked_review' : null,
      sourceCategoryId: sourceId, runtimeCategoryId: runtimeId, categoryResolution: resolution,
    };
  });

  const expenseTotal = sum(input.transactions, (x) => x.direction === 'expense');
  const incomeTotal = sum(input.transactions, (x) => x.direction === 'income');
  const net = expenseTotal - incomeTotal;
  const expected = Number(input.statement?.expectedNet ?? input.statement?.statementBalance);
  const expectedPresent = Number.isFinite(expected);

  return {
    generatedAt: new Date().toISOString(),
    source: input.source,
    wallet: { id: wallet._id, name: wallet.name, owner: wallet.owner, isOwner: wallet.owner === user?._id },
    categoryV2,
    browserWrite: client.getBrowserWriteStatus(),
    dateRange: { startDate, endDate },
    totals: {
      rowCount: rows.length,
      expenseTotal,
      incomeTotal,
      net,
      expectedNet: expectedPresent ? expected : null,
      reconciliationDifference: expectedPresent ? net - expected : null,
      ready: rows.filter((r) => r.status === 'ready').length,
      review: rows.filter((r) => r.status === 'review').length,
      skip: rows.filter((r) => r.status === 'skip').length,
      blocked: rows.filter((r) => r.status === 'blocked').length,
    },
    rows,
  };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export async function importBatch(client, rawInput, {
  rulesConfig = {}, runtimeOverrides = {}, confirmation,
  allowReview = false,
  allowReconciliationMismatch = false,
  allowSharedWallet = false,
  writeDelayMs = Number(process.env.MONEYLOVER_WRITE_DELAY_MS ?? 700),
} = {}) {
  if (confirmation !== 'IMPORT') throw new Error('Import blocked: confirmation must equal IMPORT');
  const preview = await previewBatch(client, rawInput, { rulesConfig, runtimeOverrides });
  if (preview.totals.blocked > 0) throw new Error(`Import blocked: ${preview.totals.blocked} unresolved row(s)`);
  if (!allowReview && preview.totals.review > 0) throw new Error(`Import blocked: ${preview.totals.review} row(s) need review`);
  if (!allowSharedWallet && !preview.wallet.isOwner) throw new Error('Import blocked: authenticated user is not the wallet owner');
  if (!allowReconciliationMismatch && preview.totals.expectedNet !== null && preview.totals.reconciliationDifference !== 0) {
    throw new Error(`Import blocked: reconciliation difference is ${preview.totals.reconciliationDifference}`);
  }

  const candidates = preview.rows.filter((r) => r.status === 'ready' || (allowReview && r.status === 'review'));
  const results = [];
  for (const row of candidates) {
    try {
      const transaction = await client.addTransaction({
        walletId: preview.wallet.id,
        categoryId: row.sourceCategoryId,
        runtimeCategoryId: row.runtimeCategoryId,
        amount: row.amount,
        date: row.date,
        note: row.note,
      });
      results.push({ key: row.key, status: 'created', transactionId: transaction?._id ?? null, row });
    } catch (error) {
      results.push({ key: row.key, status: 'error', error: error.message, detail: error.detail ?? null, row });
      break;
    }
    if (writeDelayMs > 0) await sleep(writeDelayMs);
  }

  const verifyData = await client.getTransactions(preview.wallet.id, preview.dateRange.startDate, preview.dateRange.endDate);
  const after = verifyData?.transactions ?? [];
  for (const result of results) {
    if (result.status !== 'created') continue;
    const r = result.row;
    result.verified = after.some((tx) => dateOnly(tx?.displayDate) === r.date && Number(tx?.amount) === r.amount && norm(tx?.note) === norm(r.note));
  }

  return {
    preview,
    resultSummary: {
      attempted: results.length,
      created: results.filter((r) => r.status === 'created').length,
      verified: results.filter((r) => r.status === 'created' && r.verified).length,
      errors: results.filter((r) => r.status === 'error').length,
      skippedExisting: preview.totals.skip,
    },
    results,
  };
}
