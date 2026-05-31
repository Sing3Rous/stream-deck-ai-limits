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

export interface ClaudeUsageResponse {
	five_hour?: ClaudeUsageWindow | null;
	seven_day?: ClaudeUsageWindow | null;
	// Known sibling windows — not consumed by the MVP, kept for documentation/forward-compat.
	seven_day_opus?: ClaudeUsageWindow | null;
	seven_day_sonnet?: ClaudeUsageWindow | null;
	seven_day_oauth_apps?: ClaudeUsageWindow | null;
}
