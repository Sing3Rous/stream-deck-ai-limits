import { authRequired, genericError, rateLimited, UnauthorizedError } from "../../utils/errors.ts";
import { parseRetryAfterMs } from "../../utils/http.ts";
import type { CopilotUsageResponse } from "./copilot-types.ts";

export { UnauthorizedError };

/**
 * Unofficial internal GitHub endpoint returning Copilot quota snapshots for the authenticated
 * user. Works with a token from `gh auth token`; subject to change without notice.
 */
const COPILOT_USAGE_ENDPOINT = "https://api.github.com/copilot_internal/user";

/** Requests longer than this are aborted (8 s). */
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Fetch the raw Copilot usage response for the given token.
 *
 * @throws {UsageError} `auth_required` (401/403), `rate_limited` (429), or `error` on other
 *   failures. A 401 is rethrown as {@link UnauthorizedError} so the provider can re-read
 *   credentials and retry once. Error messages never include the token.
 */
export async function fetchCopilotUsage(accessToken: string): Promise<CopilotUsageResponse> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(COPILOT_USAGE_ENDPOINT, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
			signal: controller.signal,
		});
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw genericError("Usage request timed out.");
		}
		throw genericError("Usage request network error.");
	} finally {
		clearTimeout(timer);
	}

	if (response.status === 401) {
		throw new UnauthorizedError();
	}
	if (response.status === 403) {
		throw authRequired("Copilot usage request was forbidden. Log in with the GitHub CLI (gh auth login).");
	}
	if (response.status === 429) {
		throw rateLimited("Copilot usage rate limit reached.", parseRetryAfterMs(response.headers.get("retry-after")));
	}
	if (!response.ok) {
		throw genericError(`Copilot usage request failed (HTTP ${response.status}).`);
	}

	try {
		return (await response.json()) as CopilotUsageResponse;
	} catch {
		throw genericError("Copilot usage response was not valid JSON.");
	}
}
