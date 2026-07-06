import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

import { authRequired } from "../../utils/errors.ts";
import { resolveClaudeCredentialsPath } from "../../utils/paths.ts";

/**
 * OAuth credentials extracted from Claude Code's `~/.claude/.credentials.json`, or — on macOS,
 * where the CLI stores them in the login Keychain instead — from the Keychain item of the same
 * JSON shape.
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

/** Raw shape of the relevant slice of `.credentials.json` (file and Keychain use the same shape). */
interface RawCredentialsFile {
	claudeAiOauth?: {
		accessToken?: unknown;
		refreshToken?: unknown;
		expiresAt?: unknown;
	};
}

/** The Keychain service name Claude Code uses on macOS for its OAuth credentials. */
export const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";

/** Reads the password blob of a generic Keychain item. Injectable for tests. */
export type KeychainPasswordReader = (service: string) => Promise<string>;

/** Guard against a hung `security` invocation blocking a refresh cycle forever. */
const SECURITY_TIMEOUT_MS = 5_000;

/**
 * Read a generic password from the macOS login Keychain via `/usr/bin/security`.
 *
 * @throws A generic `Error` when the item is missing or access is denied; callers translate to
 *   an `auth_required` {@link UsageError}. Never includes stdout (token material) in the error.
 */
function readKeychainPassword(service: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"/usr/bin/security",
			["find-generic-password", "-s", service, "-w"],
			{ timeout: SECURITY_TIMEOUT_MS, maxBuffer: 64 * 1024 },
			(err, stdout) => {
				if (err) {
					reject(new Error("Keychain lookup failed."));
					return;
				}
				resolve(stdout);
			},
		);
	});
}

/**
 * Parse a credentials JSON blob (file contents or Keychain password) into
 * {@link ClaudeCredentials}.
 *
 * @param sourceLabel Where the blob came from, for secret-free error messages
 *   (e.g. `"file"`, `"Keychain item"`).
 * @throws {UsageError} with status `auth_required` if malformed or missing an access token.
 */
function parseClaudeCredentials(contents: string, sourceLabel: string): ClaudeCredentials {
	let parsed: RawCredentialsFile;
	try {
		parsed = JSON.parse(contents) as RawCredentialsFile;
	} catch {
		throw authRequired(`Claude credentials ${sourceLabel} is not valid JSON.`);
	}

	const oauth = parsed?.claudeAiOauth;
	const accessToken = typeof oauth?.accessToken === "string" ? oauth.accessToken : "";
	if (!accessToken) {
		throw authRequired(`Claude credentials ${sourceLabel} has no access token.`);
	}

	return {
		accessToken,
		refreshToken: typeof oauth?.refreshToken === "string" ? oauth.refreshToken : null,
		expiresAt: typeof oauth?.expiresAt === "number" ? oauth.expiresAt : null,
	};
}

/**
 * Read and parse Claude Code credentials from the macOS login Keychain, where the CLI stores
 * them by default on macOS (it only writes `~/.claude/.credentials.json` when the Keychain is
 * unavailable).
 *
 * @param readPassword Injectable Keychain reader (tests). Defaults to `/usr/bin/security`.
 * @throws {UsageError} with status `auth_required` if the item is missing, unreadable,
 *   malformed, or contains no access token. Error messages never include token material.
 */
export async function readClaudeCredentialsFromKeychain(
	readPassword: KeychainPasswordReader = readKeychainPassword,
): Promise<ClaudeCredentials> {
	let contents: string;
	try {
		contents = await readPassword(CLAUDE_KEYCHAIN_SERVICE);
	} catch {
		throw authRequired(
			"Claude credentials not found (checked file and macOS Keychain). Log in with Claude Code first.",
		);
	}
	return parseClaudeCredentials(contents, "Keychain item");
}

/** Injectable seams for {@link readClaudeCredentials}; production callers omit this. */
interface ReadClaudeCredentialsOptions {
	/** Platform override for tests. Defaults to `process.platform`. */
	platform?: NodeJS.Platform;
	/** Keychain fallback override for tests. Defaults to {@link readClaudeCredentialsFromKeychain}. */
	keychainReader?: () => Promise<ClaudeCredentials>;
}

/**
 * Read and parse Claude Code credentials from disk, falling back to the macOS Keychain when the
 * default file is absent (on macOS the CLI keeps credentials in the login Keychain, so the file
 * often does not exist at all).
 *
 * The Keychain fallback only applies when no `customPath` override is set — an explicit path
 * from the Property Inspector means the user wants that file, so a missing file stays an error.
 *
 * @param customPath Optional override path (Property Inspector). Defaults to
 *   `~/.claude/.credentials.json`.
 * @throws {UsageError} with status `auth_required` if the credentials are missing, unreadable,
 *   malformed, or contain no access token. Error messages never include token material.
 */
export async function readClaudeCredentials(
	customPath?: string,
	options: ReadClaudeCredentialsOptions = {},
): Promise<ClaudeCredentials> {
	const filePath = resolveClaudeCredentialsPath(customPath);
	const platform = options.platform ?? process.platform;
	const keychainReader = options.keychainReader ?? readClaudeCredentialsFromKeychain;

	let contents: string;
	try {
		contents = await readFile(filePath, "utf-8");
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code;
		if (code === "ENOENT") {
			if (platform === "darwin" && !customPath?.trim()) {
				return keychainReader();
			}
			throw authRequired("Claude credentials file not found. Log in with Claude Code first.");
		}
		throw authRequired("Could not read Claude credentials file.");
	}

	return parseClaudeCredentials(contents, "file");
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
