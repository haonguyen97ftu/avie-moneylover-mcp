# Deploy a private cloud MCP for ChatGPT

This setup gives one ChatGPT account an HTTPS MCP endpoint that remains reachable when your computer is off, including from the ChatGPT mobile app. It is a private single-user connector, not a public multi-user service.

## 1. Deploy on Railway

1. Create a Railway project from this GitHub repository.
2. Railway detects `Dockerfile`; the included `railway.json` configures `/health` as the health check.
3. In the service **Variables** page, add:

   - `MCP_AUTH_SECRET`: at least 32 random characters. Generate it locally with `openssl rand -hex 32` or a password manager.
   - `MCP_OWNER_PASSWORD`: a long unique password used only to authorize ChatGPT.
   - `MONEYLOVER_ACCESS_TOKEN`: a fresh Money Lover owner token.
   - Optionally `MONEYLOVER_CF_CLEARANCE` and `MONEYLOVER_USER_AGENT` if writes require the browser/Cloudflare session.

4. Generate a public Railway domain in **Settings → Networking**.
5. Add `MCP_PUBLIC_URL=https://YOUR-DOMAIN` using the exact origin, with no `/mcp` suffix and no trailing slash.
6. Redeploy, then open `https://YOUR-DOMAIN/health`. It should return `{"ok":true,...}`.

Never put real secret values in GitHub, a `.env` commit, ChatGPT messages, logs, or screenshots. The checked-in `.env.example` contains names only.

## 2. Connect ChatGPT

Custom connector creation is easiest from ChatGPT web:

1. Open **Settings → Security and login** and enable **Developer mode**.
2. Open **ChatGPT Plugins**, select the plus button, and connect `https://YOUR-DOMAIN/mcp` in developer mode.
3. Complete the authorization page using `MCP_OWNER_PASSWORD`. This is not your Money Lover password.
4. Enable the connector in a new chat and first run a read-only request such as “list my Money Lover wallets”.
5. On mobile, sign into the same ChatGPT account, open a new chat, and enable the same connector from Apps/Tools.

The service supports OAuth dynamic client registration, authorization code + PKCE, refresh tokens, and protected-resource discovery expected by remote MCP clients.

## 3. Safe smoke test

Run these in order:

1. `get_user_info`
2. `get_wallets`
3. `get_categories` for an owner wallet
4. `preview_transaction` with synthetic values — it does not write
5. Only after reviewing the preview, call `add_transaction` with `confirmation: "ADD"`

For a statement, call `preview_statement`, inspect totals and every flagged row, then pass its `previewId` to `confirm_statement_import` with `confirmation: "IMPORT"`. Preview IDs expire after 30 minutes and are lost on a deployment restart.

## Limits and troubleshooting

- Money Lover uses an unofficial/private web API and can change it without notice.
- Reads may work while writes fail because Money Lover or Cloudflare rejects a cloud IP or an expired browser cookie.
- If that happens, refresh the Money Lover token/cookie in Railway Variables and redeploy. Never send those values through chat.
- Railway's filesystem is ephemeral. The token cache is only a convenience; set `MONEYLOVER_ACCESS_TOKEN` directly for predictable cloud operation.
- A service restart invalidates outstanding OAuth authorization codes. Signed access and refresh tokens remain valid when `MCP_AUTH_SECRET` and `MCP_PUBLIC_URL` are unchanged; access tokens expire within one hour and refresh tokens within 30 days.
- A custom domain is optional; Railway's generated HTTPS domain is sufficient.

Use local mode (`npm run start:stdio` or the batch scripts) as the fallback when Money Lover blocks cloud-origin writes.
