function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

function transactionId(transaction) {
  return transaction?._id ?? transaction?.id ?? null;
}

function accountId(transaction) {
  return transaction?.account?._id ?? transaction?.account?.id ?? transaction?.account ?? null;
}

function categoryIds(transaction) {
  return [
    transaction?.category?._id,
    transaction?.category?.id,
    ...(Array.isArray(transaction?.category?.categories) ? transaction.category.categories : []),
  ].filter(Boolean).map(String);
}

function compactTransaction(transaction) {
  return {
    id: transactionId(transaction),
    amount: transaction?.amount ?? null,
    note: transaction?.note ?? '',
    date: String(transaction?.displayDate ?? transaction?.date ?? '').slice(0, 10),
    category: transaction?.category?.name ?? null,
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value ?? null;
}

function normalizedAddress(transaction) {
  let address = transaction?.address ?? {};
  if (typeof address === 'string' && address.trim()) {
    try { address = JSON.parse(address); } catch { return { raw: address }; }
  }
  if (!address || typeof address !== 'object') return {};
  return {
    name: address.name ?? '',
    details: address.details ?? '',
    icon: address.icon ?? '',
  };
}

function transactionFingerprint(transaction, { includeCategory = true } = {}) {
  const fingerprint = {
    id: transactionId(transaction),
    account: accountId(transaction),
    amount: Math.abs(Number(transaction?.amount)),
    note: transaction?.note ?? '',
    displayDate: String(transaction?.displayDate ?? transaction?.date ?? '').slice(0, 10),
    with: Array.isArray(transaction?.with) ? transaction.with.map((item) => String(item).trim()) : [],
    eventIds: Array.isArray(transaction?.campaign)
      ? transaction.campaign.map((item) => item?._id ?? item?.id ?? item).filter(Boolean).map(String).sort()
      : [],
    exclude_report: Boolean(transaction?.exclude_report),
    longtitude: transaction?.longtitude ?? 0,
    latitude: transaction?.latitude ?? 0,
    address: normalizedAddress(transaction),
    image: transaction?.images?.[0] ?? transaction?.image ?? '',
    remind: transaction?.remind ?? null,
    parent: transaction?.parent?._id ?? transaction?.parent ?? null,
  };
  if (includeCategory) fingerprint.categoryIds = categoryIds(transaction).sort();
  return JSON.stringify(stableValue(fingerprint));
}

async function assertWalletOwner(client, walletId) {
  const [user, wallets] = await Promise.all([client.getUserInfo(), client.getWallets()]);
  const wallet = (wallets ?? []).find((item) => item?._id === walletId || item?.id === walletId);
  if (!wallet) throw new Error(`Wallet ${walletId} is not accessible`);
  if (wallet.owner !== user?._id) throw new Error('Update blocked: authenticated user is not the wallet owner');
  return wallet;
}

async function loadTransaction(client, walletId, date, wantedId) {
  const data = await client.getTransactions(walletId, date, date);
  const transaction = (data?.transactions ?? []).find((item) => transactionId(item) === wantedId);
  if (!transaction) throw new Error(`Transaction ${wantedId} was not found in wallet ${walletId} on ${date}`);
  if (String(accountId(transaction)) !== walletId) throw new Error('Update blocked: transaction account does not match the requested wallet');
  return transaction;
}

function hasTargetCategory(transaction, target) {
  const ids = new Set(categoryIds(transaction));
  return [target.sourceId, target.runtimeId].filter(Boolean).some((id) => ids.has(String(id)));
}

export async function previewTransactionUpdate(client, input) {
  const walletId = requiredString(input.walletId, 'walletId');
  const wantedId = requiredString(input.transactionId, 'transactionId');
  const date = requiredString(input.date, 'date');
  if (!input.categoryId && !input.categoryName) {
    throw new Error('Provide categoryId or categoryName so the target category can be reviewed');
  }

  const wallet = await assertWalletOwner(client, walletId);
  const current = await loadTransaction(client, walletId, date, wantedId);
  const resolved = await client.resolveWriteCategory(walletId, input);
  const target = {
    sourceId: resolved.source?._id ?? resolved.source?.id ?? input.categoryId ?? null,
    runtimeId: resolved.runtimeId,
    name: resolved.source?.name ?? input.categoryName ?? current?.category?.name ?? null,
    resolution: resolved.resolution,
  };
  const before = compactTransaction(current);
  const preview = {
    willWrite: false,
    wallet: { id: walletId, name: wallet.name, isOwner: true },
    before,
    after: { ...before, category: target.name },
    categoryResolution: target.resolution,
    noChange: hasTargetCategory(current, target),
  };
  const plan = {
    walletId,
    transactionId: wantedId,
    date,
    target,
    sourceFingerprint: transactionFingerprint(current),
    baseFingerprint: transactionFingerprint(current, { includeCategory: false }),
  };
  return { plan, preview };
}

export async function applyTransactionUpdate(client, plan) {
  await assertWalletOwner(client, plan.walletId);
  const current = await loadTransaction(client, plan.walletId, plan.date, plan.transactionId);
  const baseFingerprint = transactionFingerprint(current, { includeCategory: false });

  if (transactionFingerprint(current) !== plan.sourceFingerprint) {
    if (baseFingerprint === plan.baseFingerprint && hasTargetCategory(current, plan.target)) {
      return { updated: false, reason: 'already_applied', transaction: compactTransaction(current) };
    }
    throw new Error('Update blocked: transaction changed after preview. Run preview_update_transaction again.');
  }

  if (hasTargetCategory(current, plan.target)) {
    return { updated: false, reason: 'already_in_target_category', transaction: compactTransaction(current) };
  }

  await client.editTransaction({
    walletId: plan.walletId,
    transaction: current,
    runtimeCategoryId: plan.target.runtimeId,
  });

  const updated = await loadTransaction(client, plan.walletId, plan.date, plan.transactionId);
  if (!hasTargetCategory(updated, plan.target)) throw new Error('Update verification failed: target category was not observed');
  if (transactionFingerprint(updated, { includeCategory: false }) !== plan.baseFingerprint) {
    throw new Error('Update verification failed: a non-category transaction field changed');
  }
  return {
    updated: true,
    categoryResolution: plan.target.resolution,
    transaction: compactTransaction(updated),
  };
}

export { transactionFingerprint };
