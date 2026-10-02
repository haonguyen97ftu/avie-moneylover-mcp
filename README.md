# Avie Money Lover MCP — Cloud + Local Bridge

[![CI](https://github.com/haonguyen97ftu/avie-moneylover-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/haonguyen97ftu/avie-moneylover-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)

Unofficial Money Lover integration for three workflows:

1. **Private cloud MCP** — use the connector from ChatGPT on desktop and phone through one HTTPS endpoint.
2. **Local MCP (stdio)** — connect from a compatible desktop client without publishing an endpoint.
3. **GPT + local bridge** — let ChatGPT prepare/review statement JSON while your own machine performs the final import.

> **Unofficial project.** This repository is not affiliated with, endorsed by, or sponsored by Money Lover. It uses web endpoints observed from the Money Lover web app. Those endpoints, authentication flows, category behavior, and anti-bot requirements can change without notice.

## What it can do

- Read authenticated user info
- List wallets and wallet categories
- Read transactions by date range
- Resolve Money Lover `user_category_v2` source IDs to runtime IDs using transaction history
- Preview a single transaction without writing
- Add a transaction with duplicate protection
- Preview and apply category-only transaction updates without delete/recreate workarounds
- Preview a bank/card statement batch
- Reconcile expense − income against a statement total
- Flag exact duplicates, probable duplicates, unresolved categories, and review rows
- Import sequentially only after explicit confirmation
- Verify created transactions by reading them back
- Safely re-run after a partial import: exact duplicates are skipped

## Requirements

- Windows 10/11, macOS, or Linux
- Node.js **22+**
- A Money Lover account you control
- For reliable writes: a fresh **wallet-owner** session, current browser cookie/`cf_clearance` if required, and the matching browser User-Agent

## Quick start

```bash
git clone https://github.com/haonguyen97ftu/avie-moneylover-mcp.git
cd avie-moneylover-mcp
npm install
npm test
```

## Private cloud MCP (recommended for phone use)

This repository includes a stateless Streamable HTTP endpoint at `/mcp`, single-user OAuth with PKCE, a Dockerfile, and Railway configuration. Secrets stay in the host's environment variables and are never MCP tool arguments.

Deploy and connect it using [the cloud deployment guide](docs/CLOUD_DEPLOYMENT.md). In short:

1. Deploy this repository to Railway.
2. Add the variables from `.env.example` in Railway; never commit their real values.
3. Generate a public Railway domain and set `MCP_PUBLIC_URL` to that exact HTTPS origin.
4. Add `https://YOUR-DOMAIN/mcp` as a custom connector in ChatGPT Developer mode.
5. Authorize using `MCP_OWNER_PASSWORD` (not your Money Lover password).

Once the connector is enabled for your ChatGPT account, it can be used by supported ChatGPT mobile clients too. Initial custom-connector setup is easiest in ChatGPT web.

### Windows helper setup

```cmd
scripts\setup-windows.cmd
```

Set credentials in the current shell only:

```cmd
set "MONEYLOVER_ACCESS_TOKEN=YOUR_FRESH_OWNER_TOKEN"
set "MONEYLOVER_CF_CLEARANCE=YOUR_CURRENT_CF_CLEARANCE_VALUE"
set "MONEYLOVER_USER_AGENT=YOUR_EXACT_BROWSER_USER_AGENT"
```

Then run:

```cmd
scripts\doctor.cmd
```

## Recommended GPT + local workflow

```text
Bank/card statement
        ↓
ChatGPT extracts + categorizes
        ↓
statement JSON
        ↓
local preview
        ↓
review / duplicate / reconciliation checks
        ↓
explicit IMPORT confirmation
        ↓
Money Lover
        ↓
local verification report
```

Do **not** paste Money Lover tokens, refresh tokens, passwords, browser cookies, or `cf_clearance` into ChatGPT, GitHub issues, logs, or screenshots. ChatGPT only needs the statement plus the generated preview/result JSON.

### Preview a statement

```cmd
scripts\preview.cmd data\your-statement.json
```

### Import after review

```cmd
scripts\import.cmd data\your-statement.json
```

The importer requires you to type exactly:

```text
IMPORT
```

before writes begin.

See [docs/HUONG_DAN_SU_DUNG.md](docs/HUONG_DAN_SU_DUNG.md) for the complete Vietnamese guide.

## API behavior observed

Authenticated requests currently use:

```text
Authorization: AuthJWT <access_token>
```

Observed endpoints:

| Client method | HTTP | Endpoint |
|---|---|---|
| `getUserInfo()` | POST | `/api/user/info` |
| `getWallets()` | POST | `/api/wallet/list` |
| `getCategories(walletId)` | POST | `/api/category/list` |
| `getTransactions(...)` | POST | `/api/transaction/list` |
| `addTransaction(...)` | POST | `/api/transaction/add` |
| `editTransaction(...)` | POST | `/api/transaction/edit` |

Writes may require browser-like headers and a current Cloudflare session. Supported environment variables include:

- `MONEYLOVER_ACCESS_TOKEN`
- `MONEYLOVER_CF_CLEARANCE`
- `MONEYLOVER_COOKIE`
- `MONEYLOVER_USER_AGENT`
- `MONEYLOVER_TIMEOUT_MS`
- `MONEYLOVER_CATEGORY_LOOKBACK_DAYS`
- `MONEYLOVER_WRITE_DELAY_MS`
- `MCP_PUBLIC_URL`
- `MCP_AUTH_SECRET`
- `MCP_OWNER_PASSWORD`

## Batch statement format

Start from [data/example-statement.json](data/example-statement.json). Full field documentation is in [docs/STATEMENT_FORMAT.md](docs/STATEMENT_FORMAT.md).

Preview:

```cmd
npm run preview -- data\your-statement.json
```

Import:

```cmd
npm run import -- data\your-statement.json
```

Optional flags:

- `--allow-review` — include rows intentionally left in `review` after you inspect them
- `--allow-mismatch` — bypass statement reconciliation protection; use only when you understand the discrepancy
- `--allow-shared-wallet` — bypass the owner safety check; shared-wallet writes may still fail
- `--confirm IMPORT` — non-interactive confirmation; not recommended for ordinary manual use

## Safety defaults

The importer refuses to write when:

- any row is `blocked`
- a `review` row exists unless `--allow-review` is supplied
- the statement reconciliation difference is non-zero unless `--allow-mismatch` is supplied
- the authenticated user is not the wallet owner unless `--allow-shared-wallet` is supplied
- confirmation is not exactly `IMPORT`

Amounts must be positive numbers.

Single-transaction category updates use a separate safety workflow:

1. Call `preview_update_transaction` with the wallet, transaction, current date, and target category.
2. Review the returned before/after category and short-lived `previewId`.
3. Call `update_transaction` with that `previewId` and literal confirmation `UPDATE`.

The update is blocked if the authenticated session is not the wallet owner or if the transaction changed after preview. The connector uses Money Lover's observed `/transaction/edit` endpoint, preserves the existing transaction ID and non-category fields, and reads the transaction back to verify the result.

## Category v2

Some accounts expose a source/template category ID from `/category/list`, while `/transaction/add` expects a different runtime category ID. The bridge learns this mapping from existing transactions.

If a category has never appeared in history, copy:

```text
config/runtime-category-overrides.example.json
```

to:

```text
config/runtime-category-overrides.json
```

and add the runtime ID observed from a real browser transaction request. The local override file is ignored by Git.

## Public-repo safety

The repository is configured to avoid committing local financial data by default:

- `data/*.json` is ignored except the sanitized example
- `out/` is ignored
- `.env*` is ignored
- local runtime category overrides are ignored
- local session helper files are ignored

Before pushing, run:

```cmd
npm run repo:check
npm test
```

Then inspect `git status` manually.

## Security

If a token, password, refresh token, browser cookie, or `cf_clearance` value is ever exposed, treat it as compromised and rotate/revoke the session. See [SECURITY.md](SECURITY.md).

## Contributing

Bug reports and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Never include real financial statements, account identifiers, tokens, or cookies in issues or test fixtures.

## Documentation

- [Vietnamese usage guide](docs/HUONG_DAN_SU_DUNG.md)
- [Cloud deployment and ChatGPT connection](docs/CLOUD_DEPLOYMENT.md)
- [Statement JSON format](docs/STATEMENT_FORMAT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [GitHub publishing guide](docs/GITHUB_PUBLISH.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [GPT statement normalization prompt](prompts/NORMALIZE_STATEMENT_VI.md)
- [GPT preview review prompt](prompts/REVIEW_PREVIEW_VI.md)

## License

MIT — see [LICENSE](LICENSE).
