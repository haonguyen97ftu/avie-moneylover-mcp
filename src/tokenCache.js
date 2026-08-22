import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isJwtExpired } from './moneyloverClient.js';

const CACHE_DIR = join(homedir(), '.moneylover-mcp-custom');

function cacheFilePath(email) {
  const safe = email.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  return join(CACHE_DIR, `${safe}.json`);
}

export async function readCachedToken(email) {
  try {
    const raw = await readFile(cacheFilePath(email), 'utf8');
    const parsed = JSON.parse(raw);
    const token = parsed?.token || null;
    if (!token || isJwtExpired(token)) return null;
    return token;
  } catch {
    return null;
  }
}

export async function writeCachedToken(email, token) {
  await mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(cacheFilePath(email), JSON.stringify({ token, savedAt: Date.now() }), {
    mode: 0o600,
  });
}

export async function clearCachedToken(email) {
  try {
    await rm(cacheFilePath(email), { force: true });
  } catch {
    // no-op
  }
}
