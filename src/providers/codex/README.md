# Codex provider — research findings (Phase 9)

Status: **researched and confirmed**, implementation deferred to Phase 15. Codex maps onto the
same normalized `UsageSnapshot` as Claude, so the existing cache + renderer are reusable.

## Credentials

File: `~/.codex/auth.json` (created by the Codex CLI ChatGPT login).

```jsonc
{
  "auth_mode": "chatgpt",          // ChatGPT login (not an API key)
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "<JWT>",
    "access_token": "<JWT>",        // ~2100 chars; iss=auth.openai.com, aud=api.openai.com/v1
    "refresh_token": "<opaque>",
    "account_id": "<uuid>"          // == chatgpt_account_id claim in the JWT
  },
  "last_refresh": "<ISO timestamp>"
}
```

- `access_token` is a JWT; its `exp` claim gives expiry (decode the payload — do NOT log it).
- The JWT payload `https://api.openai.com/auth.chatgpt_account_id` equals `tokens.account_id`.

## Usage endpoint (CONFIRMED via live request)

```
GET https://chatgpt.com/backend-api/codex/usage
```

Required headers:

- `Authorization: Bearer <access_token>`
- `chatgpt-account-id: <account_id>`
- `User-Agent: codex_cli_rs`   ← **mandatory**: without a CLI-like UA the backend (Cloudflare)
  returns 403 (HTML). **Gotcha:** on Node 24, undici drops a custom `user-agent` no matter how
  it's set (plain object, lowercase, or `Headers.set`) → the request goes out with undici's
  default UA → 403. Node 20 transmits it correctly. The plugin therefore pins
  `"Nodejs": { "Version": "20" }` in the manifest, and builds the headers as a `Headers`
  instance via `.set()`.

This is a real, pollable endpoint (no need to run a Codex task) — same model as Claude.
(Codex CLI *also* reads `x-codex-primary-used-percent` / `x-codex-secondary-*` response headers
on normal requests, but the dedicated `/usage` endpoint is simpler for our read-only use.)

### Response shape (confirmed)

```jsonc
{
  "plan_type": "plus",
  "rate_limit": {
    "allowed": false,
    "limit_reached": true,
    "primary_window":   { "used_percent": 1,   "limit_window_seconds": 18000,  "reset_after_seconds": 18000, "reset_at": 1780184777 },
    "secondary_window": { "used_percent": 100, "limit_window_seconds": 604800, "reset_after_seconds": 51853, "reset_at": 1780218629 }
  },
  "credits": { "has_credits": false, "unlimited": false, "balance": "0", ... },
  "rate_limit_reached_type": { "type": "rate_limit_reached", "details": "default" }
}
```

### Mapping to `UsageSnapshot`

| Codex field                              | Normalized           |
|------------------------------------------|----------------------|
| `rate_limit.primary_window`   (18000s = 5h)  | `session`        |
| `rate_limit.secondary_window` (604800s = 7d) | `weekly`         |
| `*.used_percent`  (0..100, same scale as Claude) | `usedPercent` |
| `*.reset_at` (unix **seconds**)          | `resetAt` (ISO)      |

## Open items for Phase 15

- Token refresh endpoint/flow for Codex (auth.openai.com) — not yet captured; for MVP we can
  read the file and rely on the Codex CLI to keep it fresh (like the Claude "read-only" stance),
  refreshing only if we later find the endpoint.
- 401/403/429 handling (403 here is the UA gate, not auth — handle distinctly).
- Confirm field stability across plans (Plus/Pro/Team) and when `additional_rate_limits` is set.
