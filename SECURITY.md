# Security Policy

This project talks to Money Lover through an unofficial web API and may handle sensitive financial data.

## Never commit

- access tokens
- refresh tokens
- passwords
- browser cookies / `cf_clearance`
- real statement exports
- generated transaction reports
- account-specific runtime category override files

## Exposed credentials

If a token, refresh token, password, or browser cookie is pasted into a chat, issue, commit, shared log, or screenshot, treat it as compromised. Rotate/revoke the relevant session before continuing.

## Write safety

Use a wallet-owner session. Preview every batch before import. Do not bypass reconciliation, review, or shared-wallet protections unless you have manually verified the reason.

## API stability

Money Lover may change endpoints or anti-bot behavior at any time. A successful unit test does not guarantee the private web API still behaves the same. Use `scripts/doctor.cmd` and a read-only preview before every important import session.
