/**
 * Raw shape of the GitHub Copilot usage endpoint response
 * (`GET https://api.github.com/copilot_internal/user`).
 *
 * Confirmed by a live request (2026-08-18, individual "pro" plan): `copilot_plan`, the reset
 * dates, and `quota_snapshots` keyed by entitlement. `premium_interactions` carries the monthly
 * premium-request quota; `chat`/`completions` snapshots are `{ unlimited: true }` (no quota)
 * and are not surfaced by the plugin.
 *
 * Everything is optional/nullable — this is an unofficial internal endpoint and fields may be
 * absent or change without notice.
 */

/** Per-entitlement quota snapshot, e.g. `quota_snapshots.premium_interactions`. */
export interface CopilotQuotaSnapshot {
	/** Total monthly premium-interaction allowance (e.g. 7000). */
	entitlement?: number | null;
	/** Remaining premium interactions in this cycle. */
	remaining?: number | null;
	/** Percentage of the quota still available (e.g. 91.4). */
	percent_remaining?: number | null;
	/** True when the plan has no cap (no usable percentage). */
	unlimited?: boolean | null;
	/** True when requests beyond the entitlement are permitted (metered). */
	overage_permitted?: boolean | null;
	/** Extra allowance beyond the entitlement, if overage is permitted. */
	overage_entitlement?: number | null;
	/** Number of overage interactions used. */
	overage_count?: number | null;
	/** Whether this quota currently applies. */
	has_quota?: boolean | null;
}

/** Response body of the Copilot usage endpoint. */
export interface CopilotUsageResponse {
	/** e.g. `"individual_pro"` — informational only, not used by the plugin. */
	copilot_plan?: string | null;
	/** Reset date without a time, e.g. `"2026-09-01"`. */
	quota_reset_date?: string | null;
	/** Reset timestamp (preferred source), e.g. `"2026-09-01T00:00:00Z"`. */
	quota_reset_date_utc?: string | null;
	quota_snapshots?: {
		premium_interactions?: CopilotQuotaSnapshot | null;
		chat?: CopilotQuotaSnapshot | null;
		completions?: CopilotQuotaSnapshot | null;
	} | null;
}
