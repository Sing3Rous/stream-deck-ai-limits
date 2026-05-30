import { authRequired, genericError, rateLimited, UnauthorizedError } from "../../utils/errors.ts";
import { parseRetryAfterMs } from "../../utils/http.ts";
import type { CodexUsageResponse } from "./codex-types.ts";

/** Codex usage endpoint (ChatGPT backend). Unofficial — may change. */
const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/codex/usage";

const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Headers the Codex CLI sends. The `User-Agent: codex_cli_rs` is **mandatory** — without a
 * CLI-like UA the backend returns 403 with an HTML body (confirmed in Phase 9).
 */
function usageHeaders(accessToken: string, accountId: string | null): Headers {
	// IMPORTANT: build a `Headers` instance and use `.set()`. On Stream Deck's Node 24 runtime,
	// undici drops a `User-Agent` provided via a plain object literal (any casing) and sends its
	// own default UA instead → the Codex endpoint returns 403. Setting it on a `Headers` object
	// is the only form that actually transmits the custom UA. (Verified on Node 24.13.)
	const headers = new Headers();
	headers.set("authorization", `Bearer ${accessToken}`);
	headers.set("user-agent", "codex_cli_rs");
	headers.set("accept", "application/json");
	if (accountId) {
		headers.set("chatgpt-account-id", accountId);
	}
	return headers;
}

/**
 * Fetch the raw Codex usage response.
 *
 * @throws {UnauthorizedError} on HTTP 401 (caller may refresh + retry — Codex refresh is a
 *   Phase 15 follow-up; for now this surfaces as auth_required).
 * @throws {UsageError} `auth_required` on 403, `rate_limited` on 429, `error` otherwise.
 *
 * Never logs the access token or the Authorization header.
 */
export async function fetchCodexUsage(accessToken: string, accountId: string | null): Promise<CodexUsageResponse> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(USAGE_ENDPOINT, {
			method: "GET",
			headers: usageHeaders(accessToken, accountId),
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
		throw authRequired("Codex usage request was forbidden. Log in with the Codex CLI again.");
	}
	if (response.status === 429) {
		throw rateLimited("Codex usage rate limit reached.", parseRetryAfterMs(response.headers.get("retry-after")));
	}
	if (!response.ok) {
		throw genericError(`Codex usage request failed (HTTP ${response.status}).`);
	}

	try {
		return (await response.json()) as CodexUsageResponse;
	} catch {
		throw genericError("Codex usage response was not valid JSON.");
	}
}
