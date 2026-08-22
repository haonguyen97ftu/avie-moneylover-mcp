@echo off
REM Copy this file to session-env.local.cmd (ignored by Git), then fill fresh local values.
REM Prefer setting these only for the current terminal session.
set "MONEYLOVER_ACCESS_TOKEN=REPLACE_WITH_FRESH_OWNER_TOKEN"
set "MONEYLOVER_CF_CLEARANCE=REPLACE_WITH_CF_CLEARANCE_VALUE"
set "MONEYLOVER_USER_AGENT=REPLACE_WITH_EXACT_BROWSER_USER_AGENT"
set "MONEYLOVER_TIMEOUT_MS=20000"
set "MONEYLOVER_CATEGORY_LOOKBACK_DAYS=730"
REM Optional default wallet:
REM set "ML_WALLET_ID=REPLACE_WITH_WALLET_ID"
