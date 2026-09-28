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

## Public MCP deployment

- Keep OAuth enabled for every internet-facing deployment. `MCP_AUTH_MODE=none` is only for isolated local testing and additionally requires `ALLOW_INSECURE_NO_AUTH=true`.
- Use a unique `MCP_OWNER_PASSWORD` that is not your Money Lover password.
- Generate `MCP_AUTH_SECRET` with at least 32 random characters.
- Store all real values only in the cloud provider's secret-variable UI.
- Do not share the public connector or owner password; this is a single-user service.
- Rotate the OAuth secret and owner password if the deployment URL or account ownership changes.

## API stability

Money Lover may change endpoints, authentication, category structures, or anti-bot behavior at any time. A successful unit test does not guarantee the private web API still behaves the same. Use `scripts/doctor.cmd` and a read-only preview before every important import session.

## Supported versions

Security fixes target the latest version on `main`. Older snapshots may not receive backports.
