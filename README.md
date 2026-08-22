# Avie Money Lover MCP / Local Bridge

Unofficial Money Lover integration for two workflows:

1. **MCP server** — expose Money Lover read/write tools to an MCP-capable client.
2. **GPT + local bridge** — let ChatGPT prepare/review statement JSON while your own Windows machine keeps the Money Lover token/cookie and performs the final import.

> Money Lover does not publish this web API for third-party use. Endpoints, category behavior, authentication, and Cloudflare requirements may change without notice.

## Current capabilities

- Read authenticated user info
- List wallets
- List wallet categories
- Read transactions by date range
- Resolve Money Lover `user_category_v2` source IDs to runtime IDs using transaction history
- Preview a single transaction without writing
- Add one transaction with duplicate protection
- Preview a statement batch
- Reconcile expense − income against the statement balance
- Flag exact duplicates, probable duplicates, unresolved categories, and review rows
- Import sequentially only after explicit `IMPORT` confirmation
- Verify created transactions by reading them back
- Safe re-run after partial import: exact duplicates are skipped

## Requirements

- Windows 10/11, macOS, or Linux
- Node.js **22+**
- A Money Lover account you control
- For reliable writes: a fresh **wallet-owner** session, `cf_clearance`/browser cookie if required, and the exact matching browser User-Agent

## Quick start on Windows

```cmd
cd C:\path\to\avie-moneylover-mcp
scripts\setup-windows.cmd
```

Set credentials only in your current CMD session:

```cmd
set "MONEYLOVER_ACCESS_TOKEN=YOUR_FRESH_OWNER_TOKEN"
set "MONEYLOVER_CF_CLEARANCE=YOUR_CURRENT_CF_CLEARANCE_VALUE"
set "MONEYLOVER_USER_AGENT=YOUR_EXACT_BROWSER_USER_AGENT"
```

Run the health check:

```cmd
scripts\doctor.cmd
```

For statement imports:

```cmd
scripts\preview.cmd data\your-statement.json
scripts\import.cmd data\your-statement.json
```

The import command prints the preview again and requires you to type exactly:

```text
IMPORT
```

before any transaction is created.

## Recommended GPT workflow

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

Do **not** paste Money Lover tokens, refresh tokens, browser cookies, or `cf_clearance` into ChatGPT. ChatGPT only needs the statement and the generated preview/result JSON.

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

Writes may require browser-like headers and a current Cloudflare session. The project supports:

- `MONEYLOVER_CF_CLEARANCE`
- `MONEYLOVER_COOKIE`
- `MONEYLOVER_USER_AGENT`
- `MONEYLOVER_TIMEOUT_MS`
- `MONEYLOVER_CATEGORY_LOOKBACK_DAYS`
- `MONEYLOVER_WRITE_DELAY_MS`

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
- `--allow-mismatch` — bypass statement reconciliation protection; avoid unless you have a specific reason
- `--allow-shared-wallet` — bypass the owner safety check; unsupported shared-wallet writes may still fail
- `--confirm IMPORT` — non-interactive confirmation; not recommended for normal manual use

## Safety defaults

The importer refuses to write when:

- any row is `blocked`
- any `review` row exists unless `--allow-review` is supplied
- the statement reconciliation difference is non-zero unless `--allow-mismatch` is supplied
- the authenticated user is not the wallet owner unless `--allow-shared-wallet` is supplied
- confirmation is not exactly `IMPORT`

Amounts must be positive numbers.

## Category v2

Some accounts expose a source/template category ID from `/category/list`, while `/transaction/add` expects a different runtime category ID. The bridge learns the mapping from existing transactions.

If a category has never appeared in history, copy:

```text
config/runtime-category-overrides.example.json
```

to:

```text
config/runtime-category-overrides.json
```

and add the runtime ID observed from a real browser transaction request. The local override file is ignored by Git.

## Personal data and GitHub

This repository is prepared to be GitHub-safe by default:

- `data/*.json` is ignored except the sanitized example
- `out/` is ignored
- `.env*` is ignored
- local runtime category overrides are ignored
- local session helper files are ignored

Before every push, still run a secret scan/search and inspect `git status`.

## Tests

```cmd
npm test
```

CI is included under `.github/workflows/ci.yml` and runs tests on Node 22.

## Documentation

- [Vietnamese usage guide](docs/HUONG_DAN_SU_DUNG.md)
- [Statement JSON format](docs/STATEMENT_FORMAT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [GitHub publishing guide](docs/GITHUB_PUBLISH.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [GPT statement normalization prompt](prompts/NORMALIZE_STATEMENT_VI.md)
- [GPT preview review prompt](prompts/REVIEW_PREVIEW_VI.md)

## License

The package is currently marked `UNLICENSED`. If you decide to make the repository public and want others to reuse the code, add an explicit open-source license first.
