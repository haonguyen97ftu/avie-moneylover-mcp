# Publish to GitHub

## Recommended visibility

Start with a **private** repository because this project integrates financial data, even though the repository itself is sanitized.

Suggested repository name:

```text
avie-moneylover-mcp
```

## Before publishing

Run:

```cmd
npm test
npm run repo:check
git status
```

Then check that none of these are staged:

- real statement JSON under `data/`
- `out/` reports
- `.env` files
- `config/runtime-category-overrides.json`
- `scripts/session-env.local.cmd`
- tokens, cookies, emails, wallet-specific exports

## CLI publishing workflow

After creating an empty GitHub repository:

```cmd
git init
git add .
git commit -m "Release v1.0.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/avie-moneylover-mcp.git
git push -u origin main
git tag v1.0.0
git push origin v1.0.0
```

If you use GitHub CLI and are already authenticated:

```cmd
gh repo create avie-moneylover-mcp --private --source=. --remote=origin --push
git tag v1.0.0
git push origin v1.0.0
```

Create a GitHub Release from tag `v1.0.0` and attach the release ZIP plus `SHA256SUMS.txt` if desired.

## Built-in safety check

Before `git add .` run:

```cmd
npm run repo:check
```

It blocks obvious JWTs/Cloudflare secrets and real JSON files under `data/` from the repository snapshot.
