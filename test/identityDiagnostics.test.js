import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityDiagnostics } from '../src/mcpServer.js';

test('identity diagnostics report matching paths without returning values', () => {
  const result = buildIdentityDiagnostics(
    { _id: 'user-id', profile: { ownerId: 'wallet-owner-id' }, email: 'private@example.com' },
    { _id: 'wallet-id', owner: 'wallet-owner-id', members: [{ userId: 'user-id' }] },
  );

  assert.deepEqual(result.walletOwnerMatchesUserPaths, ['profile.ownerId']);
  assert.deepEqual(result.userIdMatchesWalletPaths, ['members[].userId']);
  assert.equal(result.currentRule.matches, false);
  assert.doesNotMatch(JSON.stringify(result), /wallet-owner-id|user-id|private@example\.com/);
});
