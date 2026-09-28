# Changelog

## 1.1.0 - 2026-09-28

- Added a public Streamable HTTP MCP endpoint for ChatGPT web and mobile use.
- Added single-user OAuth authorization-code flow with PKCE and dynamic client registration.
- Removed login and token parameters from public MCP tools so secrets remain server-side.
- Added statement preview/import MCP tools with expiring preview IDs and exact-input confirmation.
- Added Docker and Railway deployment configuration plus health checks.
- Added cloud deployment documentation and OAuth/HTTP/preview-store tests.

## 1.0.0 - 2026-08-22

- Productionized the local GPT + Money Lover batch workflow.
- Added generic Windows setup, doctor, preview, and import scripts.
- Removed user-specific financial statement data from the distributable project.
- Added Git-safe ignore rules for statement data, generated reports, secrets, and runtime overrides.
- Added owner guard for batch writes.
- Added reconciliation guard that blocks non-zero statement differences by default.
- Changed transaction amount validation to require positive values.
- Added documentation for usage, architecture, statement schema, publishing, contribution, and security.
- Added GitHub Actions CI on Node 22 plus repository safety checks.
- Added Dependabot configuration for npm and GitHub Actions dependencies.
- Added safe issue and pull request templates for public collaboration.
- Added MIT License and public package metadata.
- Kept MCP server support for compatible clients.

## 0.5.0

- Added statement batch preview/import workflow with duplicate checks and post-write verification.

## 0.4.0

- Added browser-write context and category-v2 runtime ID mapping.

## 0.3.0

- Added transaction preview and duplicate protection.
