import assert from 'node:assert/strict';
import test from 'node:test';
import { UpdatePreviewStore } from '../src/updatePreviewStore.js';

test('update preview store preserves the exact plan and permits one completed update', () => {
  const store = new UpdatePreviewStore();
  const plan = { walletId: 'wallet-1', target: { runtimeId: 'family' } };
  const created = store.create({ plan, preview: { before: 'Mua sắm', after: 'Gia đình' } });
  plan.target.runtimeId = 'changed';

  assert.equal(store.startUpdate(created.previewId).plan.target.runtimeId, 'family');
  store.complete(created.previewId, { updated: true });
  assert.throws(() => store.startUpdate(created.previewId), /already been applied/);
});

test('failed update previews can be retried before expiry', () => {
  const store = new UpdatePreviewStore();
  const created = store.create({ plan: { value: 1 }, preview: { ok: true } });
  store.startUpdate(created.previewId);
  store.fail(created.previewId, new Error('temporary failure'));
  assert.equal(store.startUpdate(created.previewId).status, 'updating');
});
