import { randomUUID } from 'node:crypto';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class PreviewStore {
  constructor({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
  }

  cleanup() {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.entries.delete(id);
    }
  }

  create({ input, preview }) {
    this.cleanup();
    const id = randomUUID();
    const expiresAtMs = this.now() + this.ttlMs;
    const entry = {
      id,
      input: structuredClone(input),
      preview: structuredClone(preview),
      status: 'previewed',
      result: null,
      error: null,
      expiresAtMs,
    };
    this.entries.set(id, entry);
    return this.publicView(entry);
  }

  get(id) {
    this.cleanup();
    const entry = this.entries.get(String(id));
    if (!entry) throw new Error('Preview not found or expired. Run preview_statement again.');
    return entry;
  }

  startImport(id) {
    const entry = this.get(id);
    if (entry.status === 'importing') throw new Error('This preview is already being imported.');
    if (entry.status === 'completed') throw new Error('This preview has already been imported.');
    entry.status = 'importing';
    entry.error = null;
    return entry;
  }

  complete(id, result) {
    const entry = this.get(id);
    entry.status = 'completed';
    entry.result = structuredClone(result);
    return this.publicView(entry);
  }

  fail(id, error) {
    const entry = this.get(id);
    entry.status = 'failed';
    entry.error = String(error?.message ?? error);
    return this.publicView(entry);
  }

  publicView(entry) {
    return {
      previewId: entry.id,
      status: entry.status,
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
      preview: entry.preview,
      result: entry.result,
      error: entry.error,
    };
  }
}

