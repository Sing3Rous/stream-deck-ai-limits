# AI Coding Plan Usage — Stream Deck plugin

Show your **Claude Code**, **Codex CLI**, and **GitHub Copilot** usage limits right on your Elgato
Stream Deck keys.

Each key displays how much of your rolling **5-hour**, **weekly**, or **monthly premium** quota you've
used, color-coded by how close you are to the limit, and updates automatically. No tokens to paste —
the plugin reads the credentials the official CLIs already created when you logged in.

> [!WARNING]
> This plugin reads usage from **unofficial / internal endpoints** used by the Claude Code, Codex,
> and GitHub Copilot CLIs. They are not public APIs and **may change or break** without notice.

---

## What it looks like

Four action types (drag any of them onto a key):

| Action | Shows |
| --- | --- |
| **Claude Usage** | Claude's 5-hour and weekly usage in one key (two bars) |
| **Codex Usage** | Codex's 5-hour and weekly usage in one key (two bars) |
| **Copilot Usage** | Copilot's monthly **premium interactions** usage in one key (bar + days-left countdown) |
| **Usage (single window)** | One provider + one window, larger, with the reset date/time and/or countdown |

Color bands (configurable): `0–69%` green · `70–89%` yellow · `90–99%` orange · `100%` red.

---

## Requirements

- **Elgato Stream Deck** app 6.5+ (Windows 10+ or macOS 12+).
- For Claude usage: **[Claude Code](https://www.anthropic.com/claude-code)** installed and logged in.
  On Windows and Linux that means `~/.claude/.credentials.json` must exist; on macOS, Claude Code
  stores its credentials in the login Keychain instead and the plugin reads them from there.
- For Codex usage: **[Codex CLI](https://developers.openai.com/codex)** installed and logged in with a
  ChatGPT account (`~/.codex/auth.json` must exist).
- For Copilot usage: **[GitHub CLI](https://cli.github.com/)** installed and logged in
  (`gh auth login`). The token is read from `gh auth token` — optionally via a custom
  `hosts.yml`-style file — see [Copilot](#copilot).

You only need the CLI for the provider(s) you want to display.

---

## Installation

### From a release (recommended)

1. Download the latest `com.singerous.ai-limits.streamDeckPlugin` from the
   [Releases](https://github.com/Sing3Rous/stream-deck-ai-limits/releases) page.
2. Double-click it — the Stream Deck app installs it.
3. Find the **AI Coding Plan Usage** category in the actions list and drag an action onto a key.

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
  Leave empty to use the default. Setting this opts out of the macOS Keychain lookup: an explicit
  path is taken at face value, so a missing file there is reported as an error.

The **single-window** action adds: **Provider** (Claude/Codex/Copilot), **Window** (5-hour / weekly;
Copilot is always the monthly session), **Reset info** (date-time / countdown / both / hidden),
**Date format**, and **Provider accent** (colored frame / tinted background / none).

### Copilot

The Copilot action shows your monthly **premium interactions** quota: a bar for how much of the
month you've used, plus a "**N days left**" countdown to the quota reset.

- **Endpoint** — this reads the **unofficial internal endpoint**
  `GET https://api.github.com/copilot_internal/user` (the same one the GitHub CLI's Copilot
  subcommands use). It is **not** a public API and may change or break without notice.
- **Token** — resolved in this order:
  1. a custom **credentials path** you set in the Property Inspector (a bare token, or a
     `hosts.yml`-style file with `github.com: → oauth_token:`);
  2. the GitHub CLI's own `hosts.yml` (`%APPDATA%\GitHub CLI\hosts.yml` on Windows,
     `~/.config/gh/hosts.yml` elsewhere, or `$GH_CONFIG_DIR/hosts.yml` if set);
  3. `gh auth token` — the GitHub CLI must be installed and authenticated (`gh auth login`).
- **Settings** — the Copilot PI has the same refresh interval (60–600 s, default 120 s), warning /
  critical thresholds (70 / 90), and an optional credentials-path override. Copilot always uses the
  **session** window; there is no weekly window, so the single-window action fixes the window
  dropdown to the session for Copilot.

Changes apply live — no need to restart the plugin.

---

## Polling & rate limits

The usage endpoints are rate-limited. In particular, Claude's endpoint allows only a few requests
per 5-minute window and then returns `429` with a 5-minute back-off. The plugin therefore:

- defaults to polling every **120 s** and enforces a **60 s minimum**;
- **shares one request** only across keys with the same provider, refresh interval, resolved
  credentials path, and thresholds (matching keys don't multiply calls);
- **throttles key-press refreshes** (a press fetches at most once per 10 s; otherwise it just
  re-draws the cached value);
- on a `429`, **backs off** (honoring `Retry-After`) and keeps showing the last known numbers with a
  small "stale" dot instead of blanking the key.

Pressing a key forces an immediate refresh (subject to the throttle above).

---

## Security

- The plugin **reads local credentials** created by the official Claude Code / Codex login flows, or
  obtained from the GitHub CLI (`gh auth token`). It never asks you to paste a token.
- Tokens are kept **in memory only**. The plugin does **not** write them to Stream Deck settings, and
  does **not** modify your credentials files.
- Tokens and `Authorization` headers are **never logged**.
- Usage data is sent **only** to the provider's own usage endpoint — nowhere else. No telemetry.

---

## Troubleshooting

| Key shows | Meaning | Fix |
| --- | --- | --- |
| **Login Required** | Credentials file missing, or the session/token is invalid (401/403). | Log in with the CLI (`claude` / `codex` / `gh auth login`) and the key recovers on the next refresh. |
| **Rate Limited** | The endpoint returned `429`. | Wait — it recovers automatically. Avoid spamming the key; increase the refresh interval if it persists. |
| **Error** | Network error or an unexpected response. | Check your connection. If it persists, the unofficial endpoint may have changed — please file an issue. |
| Small dot in the corner | Data is stale (a refresh failed); the numbers shown are the last known good ones. | Usually transient; it clears on the next successful refresh. |

Plugin logs are under `com.singerous.ai-limits.sdPlugin/logs/`. They never contain tokens, but
review before sharing.

---

## Known limitations

- Built on **unofficial endpoints** — may break if the CLIs change internally.
- Codex token **auto-refresh is not implemented** yet; if the Codex session expires you'll see
  "Login Required" until you re-run the Codex CLI.
- The Copilot endpoint requires **premium plan usage** data — free-plan or unlimited responses show
  **No Data**, with no countdown.
- The plugin pins the Stream Deck **Node 20** runtime (the Node 24 runtime mishandles a header the
  Codex endpoint requires).

---

## License

[MIT](LICENSE).
