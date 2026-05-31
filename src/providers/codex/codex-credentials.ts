import { readFile } from "node:fs/promises";

import { authRequired } from "../../utils/errors.ts";
import { resolveCodexCredentialsPath } from "../../utils/paths.ts";

/**
 * Codex credentials extracted from `~/.codex/auth.json`. The access token is a JWT; its expiry
 * comes from the `exp` claim. Token values live in memory only — never log or persist them.
 */
export interface CodexCredentials {
	accessToken: string;
	accountId: string | null;
	/** Token expiry as epoch milliseconds (from the JWT `exp` claim), or `null` if undecodable. */
	expiresAt: number | null;
}

interface RawAuthFile {
	tokens?: {
		access_token?: unknown;
		account_id?: unknown;
	};
}

/**
 * Read and parse Codex credentials from disk.
 *
 * @throws {UsageError} `auth_required` if the file is missing, unreadable, malformed, or has no
 *   access token. Error messages never include token material.
 */
export async function readCodexCredentials(customPath?: string): Promise<CodexCredentials> {
	const filePath = resolveCodexCredentialsPath(customPath);

	let contents: string;
	try {
		contents = await readFile(filePath, "utf-8");
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code;
		if (code === "ENOENT") {
			throw authRequired("Codex credentials file not found. Log in with the Codex CLI first.");
		}
		throw authRequired("Could not read Codex credentials file.");
	}

	let parsed: RawAuthFile;
	try {
		parsed = JSON.parse(contents) as RawAuthFile;
	} catch {
		throw authRequired("Codex credentials file is not valid JSON.");
	}

	const tokens = parsed?.tokens;
	const accessToken = typeof tokens?.access_token === "string" ? tokens.access_token : "";
	if (!accessToken) {
		throw authRequired("Codex credentials file has no access token.");
	}

	return {
		accessToken,
		accountId: typeof tokens?.account_id === "string" ? tokens.account_id : null,
		expiresAt: jwtExpiryMs(accessToken),
	};
}

/**
 * Decode a JWT's `exp` claim (seconds) into epoch milliseconds without verifying the signature.
 * Returns `null` if the token is not a decodable JWT or has no numeric `exp`. Never logs the
 * token.
 */
export function jwtExpiryMs(token: string): number | null {
	const parts = token.split(".");
	if (parts.length !== 3) {
		return null;
	}
	try {
		const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
		const payload = JSON.parse(json) as { exp?: unknown };
		return typeof payload.exp === "number" ? payload.exp * 1000 : null;
	} catch {
		return null;
	}
}
