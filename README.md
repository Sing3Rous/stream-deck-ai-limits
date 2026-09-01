# Claude, Codex & Requesty Usage — Stream Deck plugin

Show your **Claude Code**, **Codex CLI**, and **Requesty** usage right on your Elgato Stream Deck
keys.

Each key displays how much of your rolling **5-hour** and **weekly** quota you've used — or, for
Requesty, your **org balance** and **24h / 7d spend** — color-coded by how close you are to the
limit, and updates automatically. No tokens to paste into the plugin — it reads the credentials the
official CLIs already created, or a Requesty API key from a file or environment variable.

> [!WARNING]
> This plugin reads usage from **unofficial / internal endpoints** used by the Claude Code and
> Codex CLIs — those are not public APIs and **may change or break** without notice. Requesty, on
> the other hand, uses its official Management API.

---

## What it looks like

Five action types (drag any of them onto a key):

| Action | Shows |
| --- | --- |
| **Claude Usage** | Claude's 5-hour and weekly usage in one key (two bars) |
| **Codex Usage** | Codex's 5-hour and weekly usage in one key (two bars) |
| **Requesty Usage** | Requesty org balance and 24h/7d spend in one key (three rows) |
| **Requesty Metric** | One Requesty metric (balance / 24h / 7d spend) at a larger size |
| **Usage (single window)** | One provider + one window, larger, with the reset date/time and/or countdown |

Color bands (configurable): `0–69%` green · `70–89%` yellow · `90–99%` orange · `100%` red.

---

## Requirements

- **Elgato Stream Deck** app 6.5+ (Windows 10+ or macOS 12+).
- For Claude usage: **[Claude Code](https://www.anthropic.com/claude-code)** installed and logged in
  (`~/.claude/.credentials.json` must exist).
- For Codex usage: **[Codex CLI](https://developers.openai.com/codex)** installed and logged in with a
  ChatGPT account (`~/.codex/auth.json` must exist).
- For Requesty usage: a **Requesty API key** with read permissions on your org (see
  [Requesty](#requesty)). No CLI needed.

You only need the CLI (or API key) for the provider(s) you want to display.

---

## Installation

### From a release (recommended)

1. Download the latest `com.singerous.ai-limits.streamDeckPlugin` from the
   [Releases](https://github.com/Sing3Rous/stream-deck-ai-limits/releases) page.
2. Double-click it — the Stream Deck app installs it.
3. Find the **Claude & Codex Usage** category in the actions list and drag an action onto a key.

### From source (development)

```bash
npm install
npm run build
# link the plugin into the Stream Deck app and start it:
npx streamdeck link com.singerous.ai-limits.sdPlugin
npx streamdeck restart com.singerous.ai-limits
```

`npm run watch` rebuilds and restarts the plugin on change.

---

## Settings (Property Inspector)

Select a key to configure it:

- **Refresh interval** — how often to poll (60–600 s, default 120 s). The minimum is 60 s on
  purpose; see [Polling & rate limits](#polling--rate-limits).
- **Warning / Critical thresholds** — the percentages at which a bar turns yellow / orange.
- **Credentials path** — optional override if your credentials file is in a non-standard location.
  Leave empty to use the default.

The **single-window** action adds: **Provider** (Claude/Codex), **Window** (5-hour / weekly),
**Reset info** (date-time / countdown / both / hidden), **Date format**, and **Provider accent**
(colored frame / tinted background / none).

### Requesty

The Requesty actions show your org's **balance** and your key's **spend** from Requesty's official
Management API (`api-v2.requesty.ai`):

- **Requesty Usage** — org balance, last-24h spend, and last-7d spend stacked in one key (three rows).
- **Requesty Metric** — one metric at a larger size, with a **metric** dropdown
  (balance / 24h spend / 7d spend).
- **API key** — create one in the Requesty dashboard with **read** permissions. It is resolved in
  this order:
  1. a custom **credentials path** you set in the Property Inspector (a file with a single bare key
     line);
  2. the `REQUESTY_API_KEY` environment variable;
  3. `~/.requesty/api-key` — a file containing the key on a single line.

  The key lives **in memory only** — it is never stored in Stream Deck settings.
- **Refresh interval** — same as the other actions: 60–600 s, default 120 s.
- **Dollar thresholds** — unlike the percentage-based Claude/Codex bars, Requesty thresholds are
  dollar amounts, and the direction matters: **balance** warns when it drops **LOW** (warning at $5,
  critical at $2), while **spend** (24h / 7d) warns when it goes **HIGH** (warning at $2, critical
  at $5).

Changes apply live — no need to restart the plugin.

---

## Polling & rate limits

The usage endpoints are rate-limited. In particular, Claude's endpoint allows only a few requests
per 5-minute window and then returns `429` with a 5-minute back-off. The plugin therefore:

- defaults to polling every **120 s** and enforces a **60 s minimum**;
- **shares one request** across all keys of the same provider (multiple keys don't multiply calls);
- **throttles key-press refreshes** (a press fetches at most once per 10 s; otherwise it just
  re-draws the cached value);
- on a `429`, **backs off** (honoring `Retry-After`) and keeps showing the last known numbers with a
  small "stale" dot instead of blanking the key.

Pressing a key forces an immediate refresh (subject to the throttle above).

---

## Security

- The plugin **reads local credentials** created by the official Claude Code / Codex login flows, or
  a **Requesty API key** from a file or environment variable. It never asks you to paste a token into
  the plugin.
- Tokens are kept **in memory only**. The plugin does **not** write them to Stream Deck settings, and
  does **not** modify your credentials files.
- Tokens and `Authorization` headers are **never logged**.
- Usage data is sent **only** to the provider's own usage endpoint — nowhere else. No telemetry.

---

## Troubleshooting

| Key shows | Meaning | Fix |
| --- | --- | --- |
| **Login Required** | Credentials file missing, or the session/token is invalid (401/403). | Log in with the CLI (`claude` / `codex`), or check `REQUESTY_API_KEY` / `~/.requesty/api-key`, and the key recovers on the next refresh. |
| **Rate Limited** | The endpoint returned `429`. | Wait — it recovers automatically. Avoid spamming the key; increase the refresh interval if it persists. |
| **Error** | Network error or an unexpected response. | Check your connection. If it persists, the unofficial endpoint may have changed — please file an issue. |
| Small dot in the corner | Data is stale (a refresh failed); the numbers shown are the last known good ones. | Usually transient; it clears on the next successful refresh. |

Plugin logs are under `com.singerous.ai-limits.sdPlugin/logs/`. They never contain tokens, but
review before sharing.

---

## Known limitations

- Built on **unofficial endpoints** for Claude/Codex — may break if the CLIs change internally.
- Codex token **auto-refresh is not implemented** yet; if the Codex session expires you'll see
  "Login Required" until you re-run the Codex CLI.
- The plugin pins the Stream Deck **Node 20** runtime (the Node 24 runtime mishandles a header the
  Codex endpoint requires).
- Requesty shows **org balance** and **per-key spend** — there's no per-project or per-key breakdown
  of where the spend went.

---

## License

[MIT](LICENSE).
