import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { authRequired, isUsageError } from "../../utils/errors.ts";
import { resolveCredentialsPath } from "../../utils/paths.ts";

const execFileAsync = promisify(execFile);

/** How long `gh auth token` may take before we give up (5 s). */
const GH_AUTH_TOKEN_TIMEOUT_MS = 5_000;

/** Injectable subprocess seam for testing the exact GitHub CLI invocation. */
export type GhAuthTokenExec = (
	file: string,
	args: readonly string[],
	options: { shell: false; timeout: number; windowsHide: boolean },
) => Promise<{ stdout: string }>;

const defaultGhAuthTokenExec: GhAuthTokenExec = async (file, args, options) => {
	const result = await execFileAsync(file, [...args], options);
	return { stdout: result.stdout };
};

/** Copilot credentials: a GitHub token usable against the Copilot usage endpoint. */
export interface CopilotCredentials {
	accessToken: string;
}

/**
 * Parse a `gh hosts.yml`-style file for the `github.com` host's `oauth_token`.
 *
 * Uses a narrow line-based scan (no YAML parser dependency): find the `github.com:` top-level
 * key, then the first `oauth_token:` line inside that (indented) section. Returns `null` when
 * there is no github.com host or it has no token. The token is never included in errors.
 */
/**
 * Strip one layer of matching YAML quotes. `gh` writes the token bare, but YAML permits
 * `oauth_token: "gho_..."`, and a quoted value carried through verbatim would be sent as
 * `Bearer "gho_..."` and rejected as a 401 that looks like a login problem.
 *
 * Escape sequences inside double quotes are not unescaped: a real token is alphanumeric with
 * underscores, so a backslash in one means it is not a token this plugin can use anyway.
 */
function unquote(value: string): string {
	const quote = value[0];
	if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
		return value.slice(1, -1);
	}
	return value;
}

export function parseHostsYml(contents: string): string | null {
	const lines = contents.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() !== "github.com:") {
			continue;
		}
		// Scan the indented section under github.com for its oauth_token.
		for (let j = i + 1; j < lines.length; j++) {
			const line = lines[j];
			if (line.trim() === "") {
				continue;
			}
			// A non-indented line starts a new top-level key → section ended.
			if (!/^\s/.test(line)) {
				break;
			}
			const match = /^\s*oauth_token:\s*(\S+)\s*$/.exec(line);
			if (match) {
				return unquote(match[1]);
			}
		}
	}
	return null;
}

/**
 * Default location of the GitHub CLI's host config: `%APPDATA%\GitHub CLI\hosts.yml` on
 * Windows, `~/.config/gh/hosts.yml` elsewhere. Honors `GH_CONFIG_DIR` when set (gh does too).
 */
export function defaultGhHostsYmlPath(): string {
	const configDir = process.env.GH_CONFIG_DIR?.trim();
	if (configDir) {
		return path.join(configDir, "hosts.yml");
	}
	if (process.platform === "win32" && process.env.APPDATA) {
		return path.join(process.env.APPDATA, "GitHub CLI", "hosts.yml");
	}
	return path.join(os.homedir(), ".config", "gh", "hosts.yml");
}

/**
 * Read and parse Copilot credentials, in order:
 *  1. a custom path override — a bare-token file or a gh `hosts.yml`-style file;
 *  2. the GitHub CLI's `hosts.yml` (`github.com` host's `oauth_token`);
 *  3. the `gh auth token` subprocess, falling back to the CLI's login.
 *
 * `readGhAuthTokenImpl` is injectable for tests; it defaults to the real `gh auth token`
 * subprocess (5 s timeout, no shell).
 *
 * @throws {UsageError} `auth_required` when no token can be resolved. Error messages never
 *   include token material.
 */
export async function readCopilotCredentials(
	customPath?: string,
	readGhAuthTokenImpl: () => Promise<string> = readGhAuthToken,
): Promise<CopilotCredentials> {
	if (customPath?.trim()) {
		return { accessToken: await readCustomTokenFile(resolveCredentialsPath("", customPath)) };
	}

	// 2. gh hosts.yml
	try {
		const contents = await readFile(defaultGhHostsYmlPath(), "utf-8");
		const token = parseHostsYml(contents);
		if (token) {
			return { accessToken: token };
		}
	} catch {
		// Missing/unreadable hosts.yml → fall through to `gh auth token`.
	}

	// 3. gh auth token subprocess. Normalize at the boundary so any gh failure surfaces as
	// `auth_required` with a secret-free message (UsageErrors from the real implementation pass
	// through unchanged).
	let token: string;
	try {
		token = (await readGhAuthTokenImpl()).trim();
	} catch (err) {
		if (isUsageError(err)) {
			throw err;
		}
		throw authRequired("Could not get a GitHub token from the GitHub CLI. Run `gh auth login` to sign in to GitHub.");
	}
	if (!token) {
		throw authRequired("The GitHub CLI returned an empty token. Run `gh auth login` to sign in to GitHub.");
	}
	return { accessToken: token };
}

/**
 * Read a token from a custom credentials file: a gh `hosts.yml`-style file, or a single
 * bare token line.
 *
 * @throws {UsageError} `auth_required` when the file is missing or unparseable. Error messages
 *   never include token material.
 */
async function readCustomTokenFile(filePath: string): Promise<string> {
	let contents: string;
	try {
		contents = await readFile(filePath, "utf-8");
	} catch (err) {
		const code = (err as NodeJS.ErrnoException | null)?.code;
		if (code === "ENOENT") {
			throw authRequired("Copilot credentials file not found. Run `gh auth login` to sign in to GitHub.");
		}
		throw authRequired("Could not read the Copilot credentials file.");
	}

	const fromYml = parseHostsYml(contents);
	if (fromYml) {
		return fromYml;
	}

	const lines = contents
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length !== 1 || /\s/.test(lines[0])) {
		throw authRequired("Copilot credentials file must contain a single token or a gh hosts.yml-style file.");
	}
	return lines[0];
}

/**
 * Run `gh auth token --hostname github.com` (5 s timeout, no shell) and return the trimmed token.
 *
 * @throws {UsageError} `auth_required` on any failure (gh missing, not logged in, or timeout).
 */
export async function readGhAuthToken(execImpl: GhAuthTokenExec = defaultGhAuthTokenExec): Promise<string> {
	let stdout: string;
	try {
		const result = await execImpl("gh", ["auth", "token", "--hostname", "github.com"], {
			shell: false,
			timeout: GH_AUTH_TOKEN_TIMEOUT_MS,
			windowsHide: true,
		});
		stdout = result.stdout;
	} catch {
		throw authRequired("Could not get a GitHub token from the GitHub CLI. Run `gh auth login` to sign in to GitHub.");
	}
	const token = stdout.trim();
	if (!token) {
		throw authRequired("The GitHub CLI returned an empty token. Run `gh auth login` to sign in to GitHub.");
	}
	return token;
}
