import { authRequired, genericError } from "../../utils/errors.ts";

/**
 * Public OAuth client id used by the official Claude Code CLI. This is not a secret — it is
 * embedded in the distributed `claude` binary and identifies the public client, not the user.
 */
const CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

/** Claude OAuth token endpoint (same one the Claude Code CLI refreshes against). */
const TOKEN_ENDPOINT = "https://platform.claude.com/v1/oauth/token";

const REFRESH_TIMEOUT_MS = 8_000;

/**
 * Result of a successful refresh. Tokens are returned to the caller to hold **in memory only**
 * — this plugin does not rewrite the user's `.credentials.json` (see plan decision #1).
 */
export interface RefreshedTokens {
	accessToken: string;
	/** A rotated refresh token, if the server returned one; otherwise `null`. */
	refreshToken: string | null;
	/** New expiry as epoch milliseconds, if derivable from `expires_in`; otherwise `null`. */
	expiresAt: number | null;
}

interface TokenResponse {
	access_token?: unknown;
	refresh_token?: unknown;
	expires_in?: unknown;
}

/**
 * Exchange a refresh token for a fresh access token.
 *
 * @throws {UsageError} `auth_required` if the refresh token is missing/rejected (the user must
 *   re-login via Claude Code), or `error` on network/timeout/unexpected-response. Messages and
 *   logs never include token material.
 */
export async function refreshClaudeToken(refreshToken: string | null): Promise<RefreshedTokens> {
	if (!refreshToken) {
		throw authRequired("No refresh token available. Log in with Claude Code again.");
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(TOKEN_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: CLAUDE_CODE_CLIENT_ID,
			}),
			signal: controller.signal,
		});
	} catch (err) {
		const aborted = (err as Error)?.name === "AbortError";
		throw genericError(aborted ? "Token refresh timed out." : "Token refresh network error.");
	} finally {
		clearTimeout(timer);
	}

	if (response.status === 400 || response.status === 401 || response.status === 403) {
		// Refresh token is invalid/expired/revoked — user must re-authenticate.
		throw authRequired("Claude session expired. Log in with Claude Code again.");
	}
	if (!response.ok) {
		throw genericError(`Token refresh failed (HTTP ${response.status}).`);
	}

	let body: TokenResponse;
	try {
		body = (await response.json()) as TokenResponse;
	} catch {
		throw genericError("Token refresh returned an unexpected response.");
	}

	const accessToken = typeof body.access_token === "string" ? body.access_token : "";
	if (!accessToken) {
		throw genericError("Token refresh response had no access token.");
	}

	const expiresInSec = typeof body.expires_in === "number" ? body.expires_in : null;
	return {
		accessToken,
		refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
		expiresAt: expiresInSec !== null ? Date.now() + expiresInSec * 1000 : null,
	};
}
