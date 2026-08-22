# Contributing

Thanks for helping improve this project.

## Before opening an issue

Please run the latest version from `main`, then:

```bash
npm install
npm test
npm run repo:check
```

If the problem involves a Money Lover API request, include only the minimum sanitized details needed to reproduce it.

## Never include sensitive data

Do **not** post or commit:

- access or refresh tokens
- passwords
- cookies or `cf_clearance`
- full browser request headers containing credentials
- real wallet/account IDs unless replaced with obvious placeholders
- real bank/card statements
- transaction exports containing personal financial data
- email addresses, phone numbers, names, addresses, or other personal identifiers

If a secret was exposed, rotate/revoke it before continuing.

## Pull requests

1. Fork or create a branch.
2. Keep changes focused.
3. Add or update tests for behavior changes.
4. Run:

```bash
npm test
npm run repo:check
```

5. Confirm test fixtures are synthetic/sanitized.
6. Explain API assumptions when changing unofficial endpoint behavior.

## API compatibility

Money Lover's web API is unofficial and may change. Prefer changes that:

- preserve safe defaults
- fail closed for writes
- keep preview and reconciliation checks intact
- avoid hard-coding account-specific IDs
- make assumptions explicit in comments/tests

## Commit style

Conventional-style messages are preferred, for example:

- `fix: handle changed transaction payload`
- `feat: add statement parser`
- `docs: clarify category-v2 setup`
- `test: cover duplicate detection`

## License

By contributing, you agree that your contribution may be distributed under the MIT License used by this repository.
