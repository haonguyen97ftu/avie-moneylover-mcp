# Changelog

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
