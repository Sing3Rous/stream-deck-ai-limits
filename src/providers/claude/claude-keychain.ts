import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Generic-password service name Claude Code uses for its macOS Keychain item. */
export const KEYCHAIN_SERVICE = "Claude Code-credentials";

/**
 * Absolute path rather than a bare name: `/etc/paths` puts `/usr/local/bin` ahead of
 * `/usr/bin`, so a PATH-resolved `security` could be shadowed by a planted binary on Macs
 * where that directory is user-writable — and this call hands back an OAuth token.
 */
const SECURITY_BIN = "/usr/bin/security";

/** Give up rather than stall a key refresh if the Keychain prompts or hangs. */
const KEYCHAIN_TIMEOUT_MS = 5_000;

/** The blob is a few KB in practice; cap it so a pathological item can't balloon memory. */
const KEYCHAIN_MAX_BYTES = 1024 * 1024;

/**
 * Read Claude Code's credential blob from the macOS login Keychain.
 *
 * On macOS the `claude` login flow stores its OAuth payload as a Keychain item instead of
 * writing `~/.claude/.credentials.json`, so the file that other platforms read never exists.
 * The stored payload is the *same* JSON shape as that file, which lets callers parse the
 * result with identical logic.
 *
 * @returns The raw JSON string, or `null` when the item is absent or unreadable.
 */
export async function readClaudeKeychainBlob(): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			SECURITY_BIN,
			["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
			{ encoding: "utf-8", timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: KEYCHAIN_MAX_BYTES },
		);
		const blob = stdout.trim();
		return blob.length > 0 ? blob : null;
	} catch {
		// Item missing, Keychain locked, access denied, or `security` unavailable all mean the
		// same thing to the caller: no credentials here. The raw error is deliberately swallowed
		// rather than wrapped, because `security` echoes the item it failed on.
		return null;
	}
}
