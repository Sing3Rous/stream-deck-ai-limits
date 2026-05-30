/**
 * Raw shape of the Codex usage endpoint response
 * (`GET https://chatgpt.com/backend-api/codex/usage`).
 *
 * Confirmed by a live request (Phase 9). `used_percent` is a 0..100 percentage (same scale as
 * Claude). `reset_at` is a unix timestamp in **seconds**. Everything is optional/nullable — this
 * is an unofficial endpoint and fields may be absent or change.
 */

export interface CodexRateLimitWindow {
	used_percent?: number | null;
	limit_window_seconds?: number | null;
	reset_after_seconds?: number | null;
	/** Unix timestamp in seconds. */
	reset_at?: number | null;
}

export interface CodexRateLimit {
	allowed?: boolean | null;
	limit_reached?: boolean | null;
	/** 5-hour window. */
	primary_window?: CodexRateLimitWindow | null;
	/** 7-day window. */
	secondary_window?: CodexRateLimitWindow | null;
}

export interface CodexUsageResponse {
	plan_type?: string | null;
	rate_limit?: CodexRateLimit | null;
}
