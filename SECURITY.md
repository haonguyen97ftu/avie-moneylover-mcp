# Security Policy

This project talks to Money Lover through an unofficial web API and may handle sensitive financial data.

## Never commit or post

- access tokens
- refresh tokens
- passwords
- browser cookies / `cf_clearance`
- real statement exports
- generated transaction reports
- account-specific runtime category override files
- wallet/account identifiers that can be linked to a real person
- personal details such as emails, phone numbers, addresses, or names

## Exposed credentials

If a token, refresh token, password, browser cookie, or `cf_clearance` value is pasted into a chat, issue, commit, shared log, or screenshot, treat it as compromised and rotate/revoke the relevant session before continuing.

## Reporting a security problem

Do not open a public issue containing credentials, personal data, or real financial records. If the issue can be described safely, open a sanitized GitHub issue with synthetic identifiers and the minimum reproduction details necessary. If safe disclosure is not possible, do not publish the sensitive material.

## Write safety

Use a wallet-owner session. Preview every batch before import. Do not bypass reconciliation, review, or shared-wallet protections unless you have manually verified the reason.

The project intentionally favors fail-closed behavior for transaction writes.

## API stability

Money Lover may change endpoints, authentication, category structures, or anti-bot behavior at any time. A successful unit test does not guarantee the private web API still behaves the same. Use `scripts/doctor.cmd` and a read-only preview before every important import session.

## Supported versions

Security fixes target the latest version on `main`. Older snapshots may not receive backports.
