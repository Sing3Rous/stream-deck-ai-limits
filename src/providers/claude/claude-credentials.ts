import { readFile } from "node:fs/promises";

import { authRequired } from "../../utils/errors.ts";
import { resolveClaudeCredentialsPath } from "../../utils/paths.ts";

/**
 * OAuth credentials extracted from Claude Code's `~/.claude/.credentials.json`.
 *
 * Only the fields the plugin needs are surfaced. The token values live here in memory only and
 * must never be logged or persisted by this plugin.
 */
export interface ClaudeCredentials {
	accessToken: string;
	refreshToken: string | null;
	/** Expiry as epoch milliseconds, or `null` when the file omits it. */
	expiresAt: number | null;
}

/** Raw shape of the relevant slice of `.credentials.json`. */
interface RawCredentialsFile {
	claudeAiOauth?: {
		accessToken?: unknown;
		refreshToken?: unknown;
		expiresAt?: unknown;
	};
}

/**
 * Read and parse Claude Code credentials from disk.
 *
 * @param customPath Optional override path (Property Inspector). Defaults to
 *   `~/.claude/.credentials.json`.
 * @throws {UsageError} with status `auth_required` if the file is missing, unreadable,
 *   malformed, or contains no access token. Error messages never include token material.
 */
export async function readClaudeCredentials(customPath?: string): Promise<ClaudeCredentials> {
	const filePath = resolveClaudeCredentialsPath(customPath);

	let contents: string;
	try {
		contents = await readFile(filePath, "utf-8");
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code;
		if (code === "ENOENT") {
			throw authRequired("Claude credentials file not found. Log in with Claude Code first.");
		}
		throw authRequired("Could not read Claude credentials file.");
	}

	let parsed: RawCredentialsFile;
	try {
		parsed = JSON.parse(contents) as RawCredentialsFile;
	} catch {
		throw authRequired("Claude credentials file is not valid JSON.");
	}

	const oauth = parsed?.claudeAiOauth;
	const accessToken = typeof oauth?.accessToken === "string" ? oauth.accessToken : "";
	if (!accessToken) {
		throw authRequired("Claude credentials file has no access token.");
	}

	return {
		accessToken,
		refreshToken: typeof oauth?.refreshToken === "string" ? oauth.refreshToken : null,
		expiresAt: typeof oauth?.expiresAt === "number" ? oauth.expiresAt : null,
	};
}

/** Default clock-skew safety margin: treat tokens expiring within 60s as already expired. */
export const DEFAULT_EXPIRY_SKEW_MS = 60_000;

/**
 * Whether the access token is expired (or about to expire within `skewMs`). A `null` expiry is
 * treated as not-expired — let the API decide (a 401 will trigger a refresh downstream).
 */
export function isExpired(
	expiresAt: number | null,
	skewMs: number = DEFAULT_EXPIRY_SKEW_MS,
	now: number = Date.now(),
): boolean {
	if (expiresAt === null) {
		return false;
	}
	return expiresAt - skewMs <= now;
}
