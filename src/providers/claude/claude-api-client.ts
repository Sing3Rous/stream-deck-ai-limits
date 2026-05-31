import { authRequired, genericError, rateLimited, UnauthorizedError } from "../../utils/errors.ts";
import { parseRetryAfterMs } from "../../utils/http.ts";
import type { ClaudeUsageResponse } from "./claude-types.ts";

/** Re-exported for existing call sites/tests. */
export { UnauthorizedError };

/** Claude usage endpoint (same one the Claude Code CLI calls). Unofficial — may change. */
const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";

const REQUEST_TIMEOUT_MS = 8_000;

/** Headers Claude Code sends with the OAuth usage request (confirmed from the binary). */
function usageHeaders(accessToken: string): Record<string, string> {
	return {
		Authorization: `Bearer ${accessToken}`,
		"anthropic-version": "2023-06-01",
		"anthropic-beta": "oauth-2025-04-20",
	};
}

/**
 * Fetch the raw Claude usage response.
 *
 * @param accessToken A valid OAuth access token (caller is responsible for freshness/refresh).
 * @returns The parsed raw usage response on HTTP 200.
 * @throws {UnauthorizedError} on HTTP 401 (caller may refresh + retry).
 * @throws {UsageError} `rate_limited` on 429, or `error` on network/timeout/parse/other-HTTP.
 *
 * Never logs the access token or the Authorization header.
 */
export async function fetchClaudeUsage(accessToken: string): Promise<ClaudeUsageResponse> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(USAGE_ENDPOINT, {
			method: "GET",
			headers: usageHeaders(accessToken),
			signal: controller.signal,
		});
	} catch (err) {
		const aborted = (err as Error)?.name === "AbortError";
		throw genericError(aborted ? "Usage request timed out." : "Usage request network error.");
	} finally {
		clearTimeout(timer);
	}

	if (response.status === 401) {
		throw new UnauthorizedError();
	}
	if (response.status === 403) {
		throw authRequired("Claude usage request was forbidden. Log in with Claude Code again.");
	}
	if (response.status === 429) {
		throw rateLimited("Claude usage rate limit reached.", parseRetryAfterMs(response.headers.get("retry-after")));
	}
	if (!response.ok) {
		throw genericError(`Claude usage request failed (HTTP ${response.status}).`);
	}

	try {
		return (await response.json()) as ClaudeUsageResponse;
	} catch {
		throw genericError("Claude usage response was not valid JSON.");
	}
}
