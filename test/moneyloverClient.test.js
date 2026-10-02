import test from 'node:test';
import assert from 'node:assert/strict';
import { MoneyloverClient } from '../src/moneyloverClient.js';

function fakeJwt(expSecondsFromNow = 3600) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })}.sig`;
}
function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

test('getWallets uses POST /wallet/list and AuthJWT', async () => {
  let call;
  global.fetch = async (url, init) => { call = { url: String(url), init }; return response({ error: 0, data: [] }); };
  await new MoneyloverClient(fakeJwt()).getWallets();
  assert.equal(call.url, 'https://web.moneylover.me/api/wallet/list');
  assert.match(call.init.headers.Authorization, /^AuthJWT /);
});

test('getCategories posts form-urlencoded walletId', async () => {
  let call;
  global.fetch = async (url, init) => { call = { url: String(url), init }; return response({ error: 0, data: [] }); };
  await new MoneyloverClient(fakeJwt()).getCategories('wallet-123');
  assert.equal(call.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(call.init.body, 'walletId=wallet-123');
});

test('getTransactions posts JSON to /transaction/list', async () => {
  let call;
  global.fetch = async (url, init) => { call = { url: String(url), init }; return response({ error: 0, data: { transactions: [] } }); };
  await new MoneyloverClient(fakeJwt()).getTransactions('wallet-123', '2026-08-01', '2026-08-31');
  assert.deepEqual(JSON.parse(call.init.body), { walletId: 'wallet-123', startDate: '2026-08-01', endDate: '2026-08-31' });
});

test('addTransaction mirrors observed browser write request', async () => {
  let call;
  global.fetch = async (url, init) => { call = { url: String(url), init }; return response({ error: 0, data: { _id: 'tx-1' } }); };
  const client = new MoneyloverClient(fakeJwt(), { browserCookie: 'cf_clearance=abc', userAgent: 'UA-test' });
  await client.addTransaction({ walletId: 'wallet-123', runtimeCategoryId: 'runtime-cat', amount: 12845, date: '2026-08-18', note: 'Hanoi Metro - TPBank' });
  assert.equal(call.url, 'https://web.moneylover.me/api/transaction/add');
  assert.equal(call.init.headers.Accept, 'application/json');
  assert.equal(call.init.headers.dataformat, 'json');
  assert.equal(call.init.headers.Origin, 'https://web.moneylover.me');
  assert.equal(call.init.headers.Referer, 'https://web.moneylover.me/wallet/wallet-123');
  assert.equal(call.init.headers.Cookie, 'cf_clearance=abc');
  assert.equal(call.init.headers['User-Agent'], 'UA-test');
  assert.deepEqual(JSON.parse(call.init.body), {
    with: [], account: 'wallet-123', category: 'runtime-cat', amount: 12845,
    note: 'Hanoi Metro - TPBank', displayDate: '2026-08-18', event: '', exclude_report: false,
    longtitude: 0, latitude: 0, addressName: '', addressDetails: '', addressIcon: '', image: ''
  });
});

test('editTransaction preserves transaction fields and uses the observed edit endpoint', async () => {
  let call;
  global.fetch = async (url, init) => { call = { url: String(url), init }; return response({ error: 0, data: { _id: 'tx-1' } }); };
  const client = new MoneyloverClient(fakeJwt(), { browserCookie: 'cf_clearance=abc', userAgent: 'UA-test' });
  await client.editTransaction({
    walletId: 'wallet-123',
    runtimeCategoryId: 'runtime-family',
    transaction: {
      _id: 'tx-1',
      account: { _id: 'wallet-123' },
      category: { _id: 'runtime-shopping' },
      amount: -1348760,
      note: 'Bỉm + sữa Mầm',
      displayDate: '2026-09-15T00:00:00.000Z',
      with: ['Family'],
      campaign: [{ _id: 'event-1' }],
      exclude_report: true,
      longtitude: 1,
      latitude: 2,
      address: JSON.stringify({ name: 'Home', details: 'Detail', icon: 'home' }),
      images: ['receipt.jpg'],
      remind: '2026-09-15T08:00:00.000Z',
      parent: { _id: 'parent-1' },
    },
  });
  assert.equal(call.url, 'https://web.moneylover.me/api/transaction/edit');
  assert.equal(call.init.headers.dataformat, 'json');
  assert.equal(call.init.headers.Referer, 'https://web.moneylover.me/wallet/wallet-123');
  assert.deepEqual(JSON.parse(call.init.body), {
    _id: 'tx-1', with: ['Family'], account: 'wallet-123', category: 'runtime-family', amount: 1348760,
    note: 'Bỉm + sữa Mầm', displayDate: '2026-09-15', event: 'event-1', exclude_report: true,
    longtitude: 1, latitude: 2, addressName: 'Home', addressDetails: 'Detail', addressIcon: 'home',
    remind: '2026-09-15T08:00:00.000Z', image: 'receipt.jpg', parent: 'parent-1',
  });
});

test('editTransaction blocks cross-wallet payloads before the request', async () => {
  global.fetch = async () => { throw new Error('must not call fetch'); };
  const client = new MoneyloverClient(fakeJwt());
  await assert.rejects(() => client.editTransaction({
    walletId: 'wallet-1', runtimeCategoryId: 'runtime-family',
    transaction: { _id: 'tx-1', account: { _id: 'wallet-2' }, amount: -1, displayDate: '2026-09-15' },
  }), /does not match walletId/);
});

test('runtime category map learns v2 source->runtime ids from transaction history', async () => {
  global.fetch = async (url) => {
    if (String(url).endsWith('/transaction/list')) return response({ error: 0, data: { transactions: [{
      _id: 'tx1', category: { _id: 'runtime-food', name: 'Ăn uống', categories: ['source-food'] }
    }] } });
    throw new Error('unexpected');
  };
  const map = await new MoneyloverClient(fakeJwt()).buildRuntimeCategoryMap('wallet-1', { startDate: '2026-01-01', endDate: '2026-08-22' });
  assert.equal(map.get('source-food').runtimeId, 'runtime-food');
});

test('user_category_v2 refuses to guess runtime id when no mapping exists', async () => {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/category/list')) return response({ error: 0, data: [{ _id: 'source-transport', name: 'Di chuyển', type: 2 }] });
    if (u.endsWith('/transaction/list')) return response({ error: 0, data: { transactions: [] } });
    if (u.endsWith('/user/info')) return response({ error: 0, data: { tags: ['user_category_v2'] } });
    throw new Error('unexpected');
  };
  const client = new MoneyloverClient(fakeJwt(), { categoryLookbackDays: 10 });
  await assert.rejects(() => client.resolveWriteCategory('wallet-1', { categoryName: 'Di chuyển' }), /runtime category ID/i);
});

test('explicit runtimeCategoryId works without category lookup', async () => {
  const client = new MoneyloverClient(fakeJwt());
  const r = await client.resolveWriteCategory('wallet-1', { runtimeCategoryId: 'runtime-x' });
  assert.equal(r.runtimeId, 'runtime-x');
  assert.equal(r.resolution, 'explicit_runtime_id');
});

test('API envelope errors are surfaced', async () => {
  global.fetch = async () => response({ s: false, e: 706, msg: 'Not authorized error' });
  const client = new MoneyloverClient(fakeJwt());
  await assert.rejects(() => client.getUserInfo(), /Not authorized error/);
});
