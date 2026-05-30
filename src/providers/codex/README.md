# Codex provider (planned — Phase 9)

Codex support is not implemented yet. This directory is a placeholder.

Open research questions (see `plan.md` Phase 9):

- Stable location of the Codex auth file (currently observed: `~/.codex/auth.json`,
  shape `{ tokens: { access_token, account_id, ... } }`).
- Exact usage endpoint used by the Codex CLI.
- Which response fields map to the 5-hour (session) and weekly windows.
- Handling of 401 / 429.
- Whether usage can be fetched without launching the Codex TUI.

Implementation will mirror the Claude provider (credentials → api-client → normalizer),
reusing the shared `TtlCache` and SVG renderer.
