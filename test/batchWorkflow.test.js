import test from 'node:test';
import assert from 'node:assert/strict';
import { previewBatch, normalizeBatchInput, importBatch } from '../src/batchWorkflow.js';

const walletId = 'wallet-1';
const baseInput = {
  walletId,
  statement: { expectedNet: 900 },
  transactions: [
    { key:'a', date:'2026-08-01', amount:1000, direction:'expense', categoryName:'Mua sắm', note:'Shop' },
    { key:'b', date:'2026-08-02', amount:100, direction:'income', categoryName:'Thu nhập khác', note:'Refund' },
  ],
};

function fakeClient(existing = []) {
  return {
    async getUserInfo(){ return { _id:'u1', tags:['user_category_v2'] }; },
    async getWallets(){ return [{ _id:walletId, name:'Tiền mặt', owner:'u1' }]; },
    async getCategories(){ return [
      { _id:'src-shop', name:'Mua sắm', type:2 },
      { _id:'src-income', name:'Thu nhập khác', type:1 },
    ]; },
    async buildRuntimeCategoryMap(){ return new Map([
      ['src-shop',{runtimeId:'run-shop'}],
      ['src-income',{runtimeId:'run-income'}],
    ]); },
    async getTransactions(){ return { transactions: existing }; },
    getBrowserWriteStatus(){ return { cookieConfigured:true }; },
    async addTransaction(){ return { _id:'created-1' }; },
  };
}

test('batch preview reconciles expense minus income', async () => {
  const p = await previewBatch(fakeClient(), baseInput);
  assert.equal(p.totals.expenseTotal, 1000);
  assert.equal(p.totals.incomeTotal, 100);
  assert.equal(p.totals.net, 900);
  assert.equal(p.totals.reconciliationDifference, 0);
  assert.equal(p.totals.ready, 2);
});

test('batch preview flags same date+amount as review', async () => {
  const p = await previewBatch(fakeClient([{_id:'tx1',amount:1000,displayDate:'2026-08-01T00:00:00.000Z',note:'Different',category:{_id:'run-shop',categories:['src-shop'],name:'Mua sắm'}}]), baseInput);
  assert.equal(p.rows[0].status, 'review');
  assert.equal(p.rows[0].reason, 'same_date_amount_exists');
});

test('batch preview skips exact duplicates', async () => {
  const p = await previewBatch(fakeClient([{_id:'tx1',amount:1000,displayDate:'2026-08-01T00:00:00.000Z',note:'Shop',category:{_id:'run-shop',categories:['src-shop'],name:'Mua sắm'}}]), baseInput);
  assert.equal(p.rows[0].status, 'skip');
  assert.equal(p.rows[0].reason, 'exact_duplicate');
});

test('normalizer uses merchant rules when category missing', () => {
  const input={walletId,transactions:[{date:'2026-08-01',amount:1,merchant:'HANOI_METRO_ACCT'}]};
  const rules={rules:[{contains:['HANOI_METRO'],categoryName:'Di chuyển'}]};
  assert.equal(normalizeBatchInput(input,rules).transactions[0].categoryName,'Di chuyển');
});

test('normalizer rejects zero amounts', () => {
  const input={walletId,transactions:[{date:'2026-08-01',amount:0,categoryName:'Mua sắm'}]};
  assert.throws(() => normalizeBatchInput(input), /positive number/);
});

test('import blocks reconciliation mismatch by default', async () => {
  const input={...baseInput,statement:{expectedNet:901}};
  await assert.rejects(
    () => importBatch(fakeClient(), input, { confirmation:'IMPORT', writeDelayMs:0 }),
    /reconciliation difference/
  );
});

test('import blocks shared wallet by default', async () => {
  const c=fakeClient();
  c.getWallets=async()=>[{_id:walletId,name:'Shared',owner:'someone-else'}];
  await assert.rejects(
    () => importBatch(c, baseInput, { confirmation:'IMPORT', writeDelayMs:0 }),
    /not the wallet owner/
  );
});
