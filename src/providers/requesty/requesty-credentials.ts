import { readFile } from "node:fs/promises";

import { authRequired } from "../../utils/errors.ts";
import { defaultRequestyCredentialsPath, resolveRequestyCredentialsPath } from "../../utils/paths.ts";

/**
 * Where a Requesty API key came from. The source identity (never the key itself) feeds cache
 * scoping so a key swap invalidates cached usage.
 */
export type RequestyCredentialSource = "custom" | "env" | "default";

/** Requesty credentials: the API key plus its resolution source. */
export interface RequestyCredentials {
	/** The API key. Lives in memory only — never log or persist it. */
	apiKey: string;
	/** Which source supplied the key. */
	source: RequestyCredentialSource;
}

/** Injectable file-reading seam (tests inject a fake reader). */
export type RequestyFileReader = (filePath: string) => Promise<string>;

const defaultRequestyFileReader: RequestyFileReader = (filePath) => readFile(filePath, "utf-8");

/**
 * Read a Requesty API key, in order:
 *  1. a custom path override — a file containing a single bare token line;
 *  2. the `REQUESTY_API_KEY` environment variable (trimmed, non-empty);
 *  3. the default file `~/.requesty/api-key` (single bare token line).
 *
 * A missing file is not an error by itself — it only fails once every source is exhausted. A
 * *malformed* token file (whitespace-only or multiple lines) is an immediate error.
 *
 * @throws {UsageError} `auth_required` when no source yields a key, or a token file is
 *   malformed. Error messages never include key material.
 */
export async function readRequestyCredentials(
	customPath?: string,
	readFileImpl: RequestyFileReader = defaultRequestyFileReader,
): Promise<RequestyCredentials> {
	// 1. Custom path override.
	const custom = customPath?.trim();
	if (custom) {
		try {
			const apiKey = await readBareTokenFile(resolveRequestyCredentialsPath(custom), readFileImpl);
			return { apiKey, source: "custom" };
		} catch (err) {
			if (!(err instanceof MissingCredentialsFile)) {
				throw err;
			}
			// Missing custom file → fall through to env / default file.
		}
	}

	// 2. Environment variable.
	const envKey = process.env.REQUESTY_API_KEY?.trim();
	if (envKey) {
		return { apiKey: envKey, source: "env" };
	}

	// 3. Default file.
	try {
		const apiKey = await readBareTokenFile(defaultRequestyCredentialsPath(), readFileImpl);
		return { apiKey, source: "default" };
	} catch (err) {
		if (err instanceof MissingCredentialsFile) {
			throw authRequired(
				"Requesty API key not found. Set REQUESTY_API_KEY or create ~/.requesty/api-key containing your key.",
			);
		}
		throw err;
	}
}

/**
 * Synchronous mirror of {@link readRequestyCredentials}'s resolution order, returning a stable
 * identity string for shared-cache scoping — never the key material itself:
 *
 *  1. custom path set (trimmed non-empty) → `custom:<resolved absolute path>`;
 *  2. `REQUESTY_API_KEY` env var set (trimmed non-empty) → `env`;
 *  3. otherwise → `default`.
 *
 * Unlike {@link readRequestyCredentials} this never touches the filesystem, so it can run
 * synchronously when an action computes its cache scope.
 */
export function requestyCredentialScope(customPath?: string): string {
	const custom = customPath?.trim();
	if (custom) {
		return `custom:${resolveRequestyCredentialsPath(custom)}`;
	}
	if (process.env.REQUESTY_API_KEY?.trim()) {
		return "env";
	}
	return "default";
}

/**
 * Read a Requesty API key from a single bare token line.
 *
 * @throws {MissingCredentialsFile} when the file does not exist (the caller decides whether to
 *   fall through to the next source or surface `auth_required`).
 * @throws {UsageError} `auth_required` when the file is unreadable or does not contain exactly
 *   one non-whitespace token. Error messages never include key material.
 */
async function readBareTokenFile(filePath: string, readFileImpl: RequestyFileReader): Promise<string> {
	let contents: string;
	try {
		contents = await readFileImpl(filePath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException | null)?.code;
		if (code === "ENOENT") {
			throw new MissingCredentialsFile();
		}
		throw authRequired("Could not read the Requesty credentials file.");
	}

	const lines = contents
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length !== 1 || /\s/.test(lines[0])) {
		throw authRequired("Requesty credentials file must contain a single API key on one line.");
	}
	return lines[0];
}

/** Internal marker: the requested credentials file does not exist (distinct from malformed). */
class MissingCredentialsFile extends Error {
	constructor() {
		super("Requesty credentials file not found.");
		this.name = "MissingCredentialsFile";
	}
}
