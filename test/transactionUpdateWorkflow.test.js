import assert from 'node:assert/strict';
import test from 'node:test';
import { previewTransactionUpdate, applyTransactionUpdate } from '../src/transactionUpdateWorkflow.js';

function fixtureTransaction(overrides = {}) {
  return {
    _id: 'tx-1',
    account: { _id: 'wallet-1' },
    category: { _id: 'runtime-shopping', name: 'Mua sắm', categories: ['source-shopping'] },
    amount: -1348760,
    note: 'Bỉm + sữa Mầm',
    displayDate: '2026-09-15T00:00:00.000Z',
    with: [],
    campaign: [],
    exclude_report: false,
    longtitude: 0,
    latitude: 0,
    address: '',
    images: [],
    ...overrides,
  };
}

function fakeClient() {
  let transaction = fixtureTransaction();
  let editCalls = 0;
  let editOverrides = {};
  return {
    async getUserInfo() { return { _id: 'user-1' }; },
    async getWallets() { return [{ _id: 'wallet-1', owner: 'user-1', name: 'Tiền mặt' }]; },
    async getTransactions() { return { transactions: [structuredClone(transaction)] }; },
    async resolveWriteCategory() {
      return { source: { _id: 'source-family', name: 'Gia đình' }, runtimeId: 'runtime-family', resolution: 'observed_transaction_mapping' };
    },
    async editTransaction({ runtimeCategoryId }) {
      editCalls += 1;
      transaction = fixtureTransaction({
        category: { _id: runtimeCategoryId, name: 'Gia đình', categories: ['source-family'] },
        // The real API normalizes an empty address to this equivalent shape.
        address: JSON.stringify({ name: '', details: '', icon: '' }),
        ...editOverrides,
      });
      return structuredClone(transaction);
    },
    setTransaction(value) { transaction = structuredClone(value); },
    setEditOverrides(value) { editOverrides = structuredClone(value); },
    get editCalls() { return editCalls; },
  };
}

test('preview and apply update tolerate Money Lover empty-address normalization', async () => {
  const client = fakeClient();
  const { plan, preview } = await previewTransactionUpdate(client, {
    walletId: 'wallet-1', transactionId: 'tx-1', date: '2026-09-15', categoryName: 'Gia đình',
  });

  assert.equal(preview.willWrite, false);
  assert.equal(preview.wallet.isOwner, true);
  assert.equal(preview.before.category, 'Mua sắm');
  assert.equal(preview.after.category, 'Gia đình');
  assert.equal(preview.noChange, false);

  const result = await applyTransactionUpdate(client, plan);
  assert.equal(result.updated, true);
  assert.equal(result.transaction.category, 'Gia đình');
  assert.equal(client.editCalls, 1);
});


  const client = fakeClient();
  client.setEditOverrides({ note: 'server-normalized-note' });
  const { plan } = await previewTransactionUpdate(client, {
    walletId: 'wallet-1', transactionId: 'tx-1', date: '2026-09-15', categoryName: 'Gia đình',
  });

  await assert.rejects(() => applyTransactionUpdate(client, plan), /fields changed \(note\)/);
});

test('apply blocks a transaction changed after preview without writing', async () => {
  const client = fakeClient();
  const { plan } = await previewTransactionUpdate(client, {
    walletId: 'wallet-1', transactionId: 'tx-1', date: '2026-09-15', categoryName: 'Gia đình',
  });
  client.setTransaction(fixtureTransaction({ note: 'changed elsewhere' }));

  await assert.rejects(() => applyTransactionUpdate(client, plan), /changed after preview/);
  assert.equal(client.editCalls, 0);
});

test('apply is idempotent when the target category is already present', async () => {
  const client = fakeClient();
  const { plan } = await previewTransactionUpdate(client, {
    walletId: 'wallet-1', transactionId: 'tx-1', date: '2026-09-15', categoryName: 'Gia đình',
  });
  client.setTransaction(fixtureTransaction({ category: { _id: 'runtime-family', name: 'Gia đình', categories: ['source-family'] } }));

  const result = await applyTransactionUpdate(client, plan);
  assert.equal(result.updated, false);
  assert.equal(result.reason, 'already_applied');
  assert.equal(client.editCalls, 0);
});

test('preview blocks non-owner wallet updates', async () => {
  const client = fakeClient();
  client.getWallets = async () => [{ _id: 'wallet-1', owner: 'someone-else', name: 'Shared' }];
  await assert.rejects(() => previewTransactionUpdate(client, {
    walletId: 'wallet-1', transactionId: 'tx-1', date: '2026-09-15', categoryName: 'Gia đình',
  }), /not the wallet owner/);
});
