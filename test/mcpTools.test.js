import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMoneyloverMcpServer } from '../src/mcpServer.js';

function fakeJwt(expSecondsFromNow = 3600) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })}.sig`;
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

async function connectedPair() {
  const server = createMoneyloverMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

test('MCP advertises preview and confirmed transaction update tools', async (t) => {
  const { server, client } = await connectedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const { tools } = await client.listTools();
  const preview = tools.find((tool) => tool.name === 'preview_update_transaction');
  const update = tools.find((tool) => tool.name === 'update_transaction');
  assert.ok(preview);
  assert.ok(update);
  assert.equal(preview.annotations.readOnlyHint, true);
  assert.equal(update.annotations.readOnlyHint, false);
  assert.equal(update.inputSchema.properties.confirmation.const, 'UPDATE');
});

test('parameterless read tools accept an omitted arguments field', async (t) => {
  const priorToken = process.env.MONEYLOVER_ACCESS_TOKEN;
  const priorFetch = global.fetch;
  process.env.MONEYLOVER_ACCESS_TOKEN = fakeJwt();
  global.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/wallet/list')) {
      return response({ error: 0, data: [{ _id: 'wallet-1', name: 'Test', owner: 'user-1' }] });
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const { server, client } = await connectedPair();
  t.after(async () => {
    await client.close();
    await server.close();
    global.fetch = priorFetch;
    if (priorToken === undefined) delete process.env.MONEYLOVER_ACCESS_TOKEN;
    else process.env.MONEYLOVER_ACCESS_TOKEN = priorToken;
  });

  const result = await client.callTool({ name: 'get_wallets' });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.result.length, 1);
});

test('MCP preview-update-confirm flow edits once and verifies through a read-back', async (t) => {
  const priorToken = process.env.MONEYLOVER_ACCESS_TOKEN;
  const priorFetch = global.fetch;
  process.env.MONEYLOVER_ACCESS_TOKEN = fakeJwt();
  let editCalls = 0;
  let current = {
    _id: 'tx-1', account: { _id: 'wallet-1' }, amount: -1348760, note: 'Baby supplies',
    displayDate: '2026-09-15T00:00:00.000Z', with: [], campaign: [], exclude_report: false,
    longtitude: 0, latitude: 0, address: '', images: [],
    category: { _id: 'runtime-shopping', name: 'Mua sắm', categories: ['source-shopping'] },
  };
  const observedFamily = {
    _id: 'tx-family', account: { _id: 'wallet-1' }, amount: -1, note: 'mapping',
    displayDate: '2026-09-01T00:00:00.000Z', with: [], campaign: [], exclude_report: false,
    longtitude: 0, latitude: 0, address: '', images: [],
    category: { _id: 'runtime-family', name: 'Gia đình', categories: ['source-family'] },
  };
  global.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/user/info')) return response({ error: 0, data: { _id: 'user-1', tags: ['user_category_v2'] } });
    if (path.endsWith('/wallet/list')) return response({ error: 0, data: [{ _id: 'wallet-1', owner: 'user-1', name: 'Tiền mặt' }] });
    if (path.endsWith('/category/list')) return response({ error: 0, data: [{ _id: 'source-family', name: 'Gia đình', type: 2 }] });
    if (path.endsWith('/transaction/list')) return response({ error: 0, data: { transactions: [current, observedFamily] } });
    if (path.endsWith('/transaction/edit')) {
      editCalls += 1;
      const body = JSON.parse(init.body);
      current = { ...current, category: { _id: body.category, name: 'Gia đình', categories: ['source-family'] } };
      return response({ error: 0, data: current });
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const { server, client } = await connectedPair();
  t.after(async () => {
    await client.close();
    await server.close();
    global.fetch = priorFetch;
    if (priorToken === undefined) delete process.env.MONEYLOVER_ACCESS_TOKEN;
    else process.env.MONEYLOVER_ACCESS_TOKEN = priorToken;
  });

  const previewResponse = await client.callTool({
    name: 'preview_update_transaction',
    arguments: { walletId: 'wallet-1', transactionId: 'tx-1', date: '2026-09-15', categoryName: 'Gia đình' },
  });
  const preview = previewResponse.structuredContent.result;
  assert.equal(preview.preview.before.category, 'Mua sắm');
  assert.equal(preview.preview.after.category, 'Gia đình');

  const updateResponse = await client.callTool({
    name: 'update_transaction', arguments: { previewId: preview.previewId, confirmation: 'UPDATE' },
  });
  const result = updateResponse.structuredContent.result.result;
  assert.equal(result.updated, true);
  assert.equal(result.transaction.category, 'Gia đình');
  assert.equal(editCalls, 1);
});
