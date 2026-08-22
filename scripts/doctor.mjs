import process from 'node:process';
import { MoneyloverClient } from '../src/moneyloverClient.js';

function mark(ok) { return ok ? 'OK' : 'MISSING'; }
const token = process.env.MONEYLOVER_ACCESS_TOKEN?.trim();
const cookie = process.env.MONEYLOVER_CF_CLEARANCE?.trim() || process.env.MONEYLOVER_COOKIE?.trim();
const ua = process.env.MONEYLOVER_USER_AGENT?.trim();

console.log('Avie Money Lover Bridge doctor');
console.log(`- MONEYLOVER_ACCESS_TOKEN: ${mark(Boolean(token))}`);
console.log(`- browser cookie/cf_clearance: ${mark(Boolean(cookie))}`);
console.log(`- MONEYLOVER_USER_AGENT: ${mark(Boolean(ua))}`);
console.log(`- ML_WALLET_ID: ${process.env.ML_WALLET_ID?.trim() ? 'SET' : 'optional / not set'}`);

if (!token) {
  console.error('\nSet MONEYLOVER_ACCESS_TOKEN in this terminal, then run doctor again.');
  process.exit(2);
}

try {
  const client = new MoneyloverClient(token);
  const [user, wallets] = await Promise.all([client.getUserInfo(), client.getWallets()]);
  console.log(`\nAuthenticated: yes`);
  console.log(`User ID: ${user?._id ?? '(unknown)'}`);
  console.log(`Accessible wallets: ${wallets?.length ?? 0}`);
  for (const wallet of wallets ?? []) {
    const role = wallet?.owner === user?._id ? 'owner' : 'shared';
    console.log(`- ${wallet?.name ?? '(unnamed)'} | ${wallet?._id ?? '?'} | ${role}`);
  }
  console.log('\nRead path is healthy. For writes, use a fresh owner token and matching browser cookie/User-Agent.');
} catch (error) {
  console.error(`\nDoctor failed: ${error.message}`);
  if (error?.detail?.msg) console.error(`Money Lover: ${error.detail.msg}`);
  process.exit(3);
}
