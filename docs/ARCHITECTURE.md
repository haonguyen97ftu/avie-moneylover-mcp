# Architecture

```text
Statement PDF/image
        │
        v
     ChatGPT
        │ normalized JSON
        v
┌─────────────────────┐
│ batchWorkflow.js    │
│ - validation        │
│ - reconciliation    │
│ - duplicate checks  │
│ - category mapping  │
└─────────┬───────────┘
          │
          v
┌─────────────────────┐
│ moneyloverClient.js │
│ unofficial web API  │
└─────────┬───────────┘
          │
          v
      Money Lover
```

## Modules

### `src/moneyloverClient.js`

Low-level API client. Handles AuthJWT, read endpoints, browser-like write request headers, timeout behavior, category-v2 runtime mapping, and single-transaction duplicate checks.

### `src/batchWorkflow.js`

Pure workflow layer for statement normalization, merchant rules, category resolution, reconciliation, duplicate detection, safety status, sequential import, and post-write verification.

### `scripts/batch.mjs`

Interactive CLI. Preview is read-only. Import requires explicit confirmation.

### `src/server.js`

MCP server exposing Money Lover operations for compatible MCP clients. The local GPT workflow does not require an MCP client.
