import { randomUUID } from 'node:crypto';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class UpdatePreviewStore {
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

  create({ plan, preview }) {
    this.cleanup();
    const id = randomUUID();
    const entry = {
      id,
      plan: structuredClone(plan),
      preview: structuredClone(preview),
      status: 'previewed',
      result: null,
      error: null,
      expiresAtMs: this.now() + this.ttlMs,
    };
    this.entries.set(id, entry);
    return this.publicView(entry);
  }

  get(id) {
    this.cleanup();
    const entry = this.entries.get(String(id));
    if (!entry) throw new Error('Update preview not found or expired. Run preview_update_transaction again.');
    return entry;
  }

  startUpdate(id) {
    const entry = this.get(id);
    if (entry.status === 'updating') throw new Error('This update preview is already being applied.');
    if (entry.status === 'completed') throw new Error('This update preview has already been applied.');
    entry.status = 'updating';
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
