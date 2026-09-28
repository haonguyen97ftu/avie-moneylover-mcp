import assert from 'node:assert/strict';
import test from 'node:test';
import { PreviewStore } from '../src/previewStore.js';

test('preview store preserves exact input and enforces one completed import', () => {
  let now = 1_000;
  const store = new PreviewStore({ ttlMs: 10_000, now: () => now });
  const input = { walletId: 'wallet-1', transactions: [{ amount: 42 }] };
  const created = store.create({ input, preview: { totals: { ready: 1 } } });

  input.transactions[0].amount = 999;
  const entry = store.startImport(created.previewId);
  assert.equal(entry.input.transactions[0].amount, 42);

  store.complete(created.previewId, { created: 1 });
  assert.throws(() => store.startImport(created.previewId), /already been imported/);

  now = 20_000;
  assert.throws(() => store.get(created.previewId), /not found or expired/);
});

test('failed preview can be retried before expiry', () => {
  const store = new PreviewStore();
  const created = store.create({ input: { value: 1 }, preview: { ok: true } });
  store.startImport(created.previewId);
  store.fail(created.previewId, new Error('temporary failure'));
  assert.equal(store.startImport(created.previewId).status, 'importing');
});
