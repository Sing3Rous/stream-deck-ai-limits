/**
 * Raw shape of the Claude usage endpoint response (`GET /api/oauth/usage`).
 *
 * Confirmed by a live request (Phase 4):
 *  - `utilization` is a 0..100 percentage (e.g. 86), NOT a 0..1 fraction.
 *  - `resets_at` is an ISO-8601 timestamp string.
 *  - `five_hour` and `seven_day` are the windows we consume; many sibling windows
 *    (`seven_day_opus`, `seven_day_sonnet`, ...) exist but are often `null`.
 *
 * Everything is optional/nullable on purpose: this is an unofficial endpoint and fields may be
 * absent or change. The normalizer (Phase 5) defends against missing data.
 */

export interface ClaudeUsageWindow {
	/** Percentage used, 0..100. */
	utilization?: number | null;
	/** ISO timestamp of when the window resets. */
	resets_at?: string | null;
}

/**
 * One entry of the `limits` array. `weekly_scoped` entries carry a `scope.model` naming the
 * model the window applies to (e.g. Fable) — the only place the per-model weekly limit appears.
 */
export interface ClaudeLimitEntry {
	kind?: string | null;
	group?: string | null;
	/** Percentage used, 0..100. */
	percent?: number | null;
	resets_at?: string | null;
	scope?: {
		model?: { id?: string | null; display_name?: string | null } | null;
		surface?: string | null;
	} | null;
	is_active?: boolean | null;
}

export interface ClaudeUsageResponse {
	five_hour?: ClaudeUsageWindow | null;
	seven_day?: ClaudeUsageWindow | null;
	/** Per-limit breakdown, including model-scoped weekly windows. */
	limits?: ClaudeLimitEntry[] | null;
	// Known sibling windows — not consumed by the MVP, kept for documentation/forward-compat.
	seven_day_opus?: ClaudeUsageWindow | null;
	seven_day_sonnet?: ClaudeUsageWindow | null;
	seven_day_oauth_apps?: ClaudeUsageWindow | null;
}
