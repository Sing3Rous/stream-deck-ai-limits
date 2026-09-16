import { readFile } from "node:fs/promises";

import { authRequired } from "../../utils/errors.ts";
import { resolveClaudeCredentialsPath } from "../../utils/paths.ts";
import { readClaudeKeychainBlob } from "./claude-keychain.ts";

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
 * Test seams for {@link readClaudeCredentials}.
 *
 * The platform is injected rather than read from `process.platform` at the call site so the
 * macOS fallback is exercised by the suite on every OS, not skipped everywhere but a Mac.
 */
interface ReadClaudeCredentialsOptions {
	/** Keychain reader override. Defaults to {@link readClaudeKeychainBlob}. */
	readKeychainBlob?: () => Promise<string | null>;
	/** Platform override. Defaults to `process.platform`. */
	platform?: NodeJS.Platform;
}

/** A credentials blob and where it came from, for secret-free error messages. */
interface CredentialsBlob {
	contents: string;
	/** Reads as `Claude credentials <source> is not valid JSON.` */
	source: "file" | "Keychain item";
}

/**
 * Fetch the raw credentials blob: the file, or the Keychain when the file is absent and
 * `allowKeychain` is set.
 *
 * @throws {UsageError} `auth_required` when neither source yields a blob.
 */
async function readCredentialsBlob(
	filePath: string,
	allowKeychain: boolean,
	readKeychainBlob: () => Promise<string | null>,
): Promise<CredentialsBlob> {
	try {
		return { contents: await readFile(filePath, "utf-8"), source: "file" };
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code;
		if (code !== "ENOENT") {
			throw authRequired("Could not read Claude credentials file.");
		}
	}

	// `readClaudeKeychainBlob` reports "no credentials" as null rather than by throwing, but it
	// is an injectable seam: a future reader that throws must not escape as a raw Error, because
	// `execFile` puts the child's stdout — the token — into `err.message`.
	let blob: string | null = null;
	if (allowKeychain) {
		try {
			blob = await readKeychainBlob();
		} catch {
			blob = null;
		}
	}
	if (blob === null) {
		throw authRequired("Claude credentials not found. Log in with Claude Code first.");
	}
	return { contents: blob, source: "Keychain item" };
}

/**
 * Read and parse Claude Code credentials.
 *
 * Normally this reads `~/.claude/.credentials.json`. On macOS that file does not exist —
 * Claude Code stores the identical JSON payload in the login Keychain — so when the default
 * path is missing there, the Keychain is consulted before giving up. An explicit override
 * path is always taken at face value: if the user named a file, a missing file is an error,
 * not an invitation to read the Keychain.
 *
 * @param customPath Optional override path (Property Inspector). Defaults to
 *   `~/.claude/.credentials.json`.
 * @param options Test seams; production callers omit this.
 * @throws {UsageError} with status `auth_required` if the credentials are missing, unreadable,
 *   malformed, or contain no access token. Error messages never include token material.
 */
export async function readClaudeCredentials(
	customPath?: string,
	options: ReadClaudeCredentialsOptions = {},
): Promise<ClaudeCredentials> {
	const readKeychainBlob = options.readKeychainBlob ?? readClaudeKeychainBlob;
	const platform = options.platform ?? process.platform;
	const filePath = resolveClaudeCredentialsPath(customPath);
	const usingDefaultPath = !customPath?.trim();

	const { contents, source } = await readCredentialsBlob(
		filePath,
		usingDefaultPath && platform === "darwin",
		readKeychainBlob,
	);

	let parsed: RawCredentialsFile;
	try {
		parsed = JSON.parse(contents) as RawCredentialsFile;
	} catch {
		throw authRequired(`Claude credentials ${source} is not valid JSON.`);
	}

	const oauth = parsed?.claudeAiOauth;
	const accessToken = typeof oauth?.accessToken === "string" ? oauth.accessToken : "";
	if (!accessToken) {
		throw authRequired(`Claude credentials ${source} has no access token.`);
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
