# Architecture

The MCP can run over local stdio or public Streamable HTTP. The HTTP service is stateless at the protocol layer; only short-lived batch previews are held in memory. A restart invalidates pending preview IDs but does not lose committed Money Lover transactions.

```text
ChatGPT web / mobile
        │ HTTPS + OAuth/PKCE
        v
httpServer.js (/mcp)
        │
        v
mcpServer.js ─── PreviewStore (30-minute TTL)
        │
        ├── batchWorkflow.js
        │
        v
moneyloverClient.js
        │ unofficial web API
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

### `src/mcpServer.js`

Defines the read, preview, write, and batch tools. It exposes no login tool and accepts no token/password arguments. Writes require explicit literals (`ADD` or `IMPORT`) and wallet-owner validation.

### `src/httpServer.js` and `src/oauth.js`

Expose `/mcp` through Streamable HTTP and protect it with a single-user OAuth authorization-code flow using PKCE. The OAuth owner password is separate from Money Lover credentials.

### `src/server.js`

Local stdio entrypoint for compatible MCP clients.
