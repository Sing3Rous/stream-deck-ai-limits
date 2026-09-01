/**
 * Raw shape of the Requesty Management API responses (`https://api-v2.requesty.ai`), verified
 * from the Requesty docs.
 *
 * Everything is optional/nullable — the API is a moving target and fields may be absent or
 * change without notice; the normalizer is defensive.
 */

/** Response of `GET /v1/manage/org`. */
export interface RequestyOrgResponse {
	/** Organization name (informational only). */
	name?: string | null;
	/** Current account balance in USD, e.g. `12.34`. */
	balance?: number | null;
}

/** One period's usage totals within `GET /v1/manage/apikey/self/usage`. */
export interface RequestyUsageEntry {
	/** Number of completion requests in the period. */
	completions_requests?: number | null;
	/** USD spent in the period. */
	spend?: number | null;
	/** Prompt tokens processed in the period. */
	input_tokens?: number | null;
	/** Completion tokens produced in the period. */
	output_tokens?: number | null;
	/** Total tokens processed in the period. */
	total_tokens?: number | null;
}

/** Response of `GET /v1/manage/apikey/self/usage`. */
export interface RequestyUsageResponse {
	/**
	 * Period → usage entry map. Keys are period starts, e.g. `"2026-08-31T14:00:00Z"` at hour
	 * resolution. Periods and entries may be missing.
	 */
	usage?: Record<string, RequestyUsageEntry> | null;
}
