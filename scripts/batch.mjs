import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin as inputStream, stdout as outputStream } from 'node:process';
import { MoneyloverClient } from '../src/moneyloverClient.js';
import { readJsonFile, previewBatch, importBatch } from '../src/batchWorkflow.js';

function fmt(n) { return new Intl.NumberFormat('vi-VN').format(Number(n || 0)); }
function usage() {
  console.log(`Usage:\n  node scripts/batch.mjs preview <file.json>\n  node scripts/batch.mjs import <file.json> [--confirm IMPORT] [--allow-review] [--allow-mismatch] [--allow-shared-wallet]\n\nRequired env: MONEYLOVER_ACCESS_TOKEN, plus MONEYLOVER_CF_CLEARANCE and matching MONEYLOVER_USER_AGENT for writes.`);
}

const [command, fileArg, ...flags] = process.argv.slice(2);
if (!['preview', 'import'].includes(command) || !fileArg) { usage(); process.exit(1); }
const token = process.env.MONEYLOVER_ACCESS_TOKEN;
if (!token) { console.error('MONEYLOVER_ACCESS_TOKEN is not set in this CMD window.'); process.exit(1); }
const file = path.resolve(fileArg);
const raw = await readJsonFile(file);
const rules = await readJsonFile(path.resolve('config/merchant-rules.json'));
let overrides = { byName: {}, bySourceId: {} };
try { overrides = await readJsonFile(path.resolve('config/runtime-category-overrides.json')); }
catch (error) { if (error?.code !== 'ENOENT') throw error; }
const client = new MoneyloverClient(token);

function printPreview(p) {
  console.log(`\nWallet: ${p.wallet.name} (${p.wallet.isOwner ? 'owner' : 'shared'})`);
  console.log(`Range: ${p.dateRange.startDate} -> ${p.dateRange.endDate}`);
  console.log(`Expenses: ${fmt(p.totals.expenseTotal)} | Income/refunds: ${fmt(p.totals.incomeTotal)} | Net: ${fmt(p.totals.net)} VND`);
  if (p.totals.expectedNet !== null) console.log(`Expected statement net: ${fmt(p.totals.expectedNet)} | Difference: ${fmt(p.totals.reconciliationDifference)}`);
  console.log(`Ready: ${p.totals.ready} | Review: ${p.totals.review} | Existing: ${p.totals.skip} | Blocked: ${p.totals.blocked}`);
  const nonReady = p.rows.filter((r) => r.status !== 'ready');
  if (nonReady.length) {
    console.log('\nRows needing attention:');
    for (const r of nonReady) console.log(`- [${r.status}] ${r.date} ${fmt(r.amount)} ${r.categoryName} :: ${r.note} :: ${r.reason ?? ''}`);
  }
}

if (command === 'preview') {
  const preview = await previewBatch(client, raw, { rulesConfig: rules, runtimeOverrides: overrides });
  printPreview(preview);
  await fs.mkdir(path.resolve('out'), { recursive: true });
  const outPath = path.resolve('out', `${path.basename(file, path.extname(file))}.preview.json`);
  await fs.writeFile(outPath, JSON.stringify(preview, null, 2));
  console.log(`\nFull preview saved: ${outPath}`);
  process.exit(preview.totals.blocked > 0 ? 2 : 0);
}

let confirmation = null;
const confirmIdx = flags.indexOf('--confirm');
if (confirmIdx >= 0) confirmation = flags[confirmIdx + 1] ?? null;
const allowReview = flags.includes('--allow-review');
const allowMismatch = flags.includes('--allow-mismatch');
const allowSharedWallet = flags.includes('--allow-shared-wallet');
const preview = await previewBatch(client, raw, { rulesConfig: rules, runtimeOverrides: overrides });
printPreview(preview);
if (preview.totals.blocked > 0 || (!allowReview && preview.totals.review > 0)) {
  console.error('\nImport stopped. Resolve blocked/review rows first. Use --allow-review only if you have reviewed those rows.');
  process.exit(2);
}
if (!allowSharedWallet && !preview.wallet.isOwner) {
  console.error('\nImport stopped: authenticated user is not the wallet owner.');
  process.exit(2);
}
if (!allowMismatch && preview.totals.expectedNet !== null && preview.totals.reconciliationDifference !== 0) {
  console.error(`\nImport stopped: reconciliation difference is ${fmt(preview.totals.reconciliationDifference)}. Fix the statement JSON first.`);
  process.exit(2);
}
if (!confirmation) {
  const rl = readline.createInterface({ input: inputStream, output: outputStream });
  confirmation = await rl.question(`\nType IMPORT to write ${preview.totals.ready + (allowReview ? preview.totals.review : 0)} transaction(s): `);
  rl.close();
}
if (confirmation !== 'IMPORT') { console.log('Cancelled.'); process.exit(0); }
const result = await importBatch(client, raw, {
  rulesConfig: rules, runtimeOverrides: overrides, confirmation, allowReview,
  allowReconciliationMismatch: allowMismatch, allowSharedWallet,
});
await fs.mkdir(path.resolve('out'), { recursive: true });
const outPath = path.resolve('out', `${path.basename(file, path.extname(file))}.import-result.json`);
await fs.writeFile(outPath, JSON.stringify(result, null, 2));
console.log(`\nCreated: ${result.resultSummary.created}, verified: ${result.resultSummary.verified}, errors: ${result.resultSummary.errors}, existing skipped: ${result.resultSummary.skippedExisting}`);
console.log(`Result saved: ${outPath}`);
if (result.resultSummary.errors > 0) process.exit(3);
