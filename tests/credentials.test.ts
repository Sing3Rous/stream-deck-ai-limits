import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
	readClaudeCredentials,
	readClaudeCredentialsFromKeychain,
	isExpired,
	CLAUDE_KEYCHAIN_SERVICE,
	DEFAULT_EXPIRY_SKEW_MS,
} from "../src/providers/claude/claude-credentials.ts";
import { resolveClaudeCredentialsPath } from "../src/utils/paths.ts";
import { isUsageError } from "../src/utils/errors.ts";

const VALID_FIXTURE = path.join(import.meta.dirname, "fixtures", "credentials-valid.json");

async function withTempFile(contents: string, run: (file: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "sdai-"));
	const file = path.join(dir, ".credentials.json");
	await writeFile(file, contents, "utf-8");
	try {
		await run(file);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("reads a valid credentials file", async () => {
	const creds = await readClaudeCredentials(VALID_FIXTURE);
	assert.equal(creds.accessToken, "FAKE_ACCESS_TOKEN_synthetic_value_for_tests");
	assert.equal(creds.refreshToken, "FAKE_REFRESH_TOKEN_synthetic_value_for_tests");
	assert.equal(creds.expiresAt, 7258118400000);
});

test("missing file → auth_required, message has no token", async () => {
	const missing = path.join(os.tmpdir(), "definitely-not-here-12345", ".credentials.json");
	await assert.rejects(
		() => readClaudeCredentials(missing),
		(err: unknown) => {
			assert.ok(isUsageError(err));
			assert.equal(err.status, "auth_required");
			assert.doesNotMatch(err.message, /FAKE_|eyJ|Bearer/);
			return true;
		},
	);
});

test("malformed JSON → auth_required", async () => {
	await withTempFile("{ not json", async (file) => {
		await assert.rejects(
			() => readClaudeCredentials(file),
			(err: unknown) => isUsageError(err) && err.status === "auth_required",
		);
	});
});

test("file without an access token → auth_required", async () => {
	await withTempFile(JSON.stringify({ claudeAiOauth: { refreshToken: "x" } }), async (file) => {
		await assert.rejects(
			() => readClaudeCredentials(file),
			(err: unknown) => isUsageError(err) && err.status === "auth_required",
		);
	});
});

test("errors never leak token material", async () => {
	await withTempFile(
		JSON.stringify({ claudeAiOauth: { accessToken: "SECRET_LEAK_CANARY_123" } }).replace("}", ""),
		async (file) => {
			await assert.rejects(
				() => readClaudeCredentials(file),
				(err: unknown) => {
					assert.ok(isUsageError(err));
					assert.doesNotMatch(err.message, /SECRET_LEAK_CANARY_123/);
					return true;
				},
			);
		},
	);
});

test("isExpired: past expiry is expired", () => {
	assert.equal(isExpired(1000, DEFAULT_EXPIRY_SKEW_MS, 2_000_000), true);
});

test("isExpired: far-future expiry is not expired", () => {
	const future = Date.now() + 60 * 60 * 1000;
	assert.equal(isExpired(future), false);
});

test("isExpired: within skew window counts as expired", () => {
	const now = 1_000_000;
	const soon = now + 30_000; // 30s out, inside the 60s skew
	assert.equal(isExpired(soon, DEFAULT_EXPIRY_SKEW_MS, now), true);
});

test("isExpired: null expiry is treated as not expired", () => {
	assert.equal(isExpired(null), false);
});

test("resolveClaudeCredentialsPath: default ends with .claude/.credentials.json", () => {
	const p = resolveClaudeCredentialsPath();
	assert.match(p, /[\\/]\.claude[\\/]\.credentials\.json$/);
});

test("resolveClaudeCredentialsPath: blank override falls back to default", () => {
	assert.equal(resolveClaudeCredentialsPath("   "), resolveClaudeCredentialsPath());
});

test("resolveClaudeCredentialsPath: custom absolute path is honored", () => {
	const custom = path.join(os.tmpdir(), "custom", "creds.json");
	assert.equal(resolveClaudeCredentialsPath(custom), path.resolve(custom));
});

const VALID_KEYCHAIN_BLOB = JSON.stringify({
	claudeAiOauth: {
		accessToken: "FAKE_ACCESS_TOKEN_synthetic_value_for_tests",
		refreshToken: "FAKE_REFRESH_TOKEN_synthetic_value_for_tests",
		expiresAt: 7258118400000,
	},
});

test("keychain: reads a valid Keychain item", async () => {
	const creds = await readClaudeCredentialsFromKeychain(async (service) => {
		assert.equal(service, CLAUDE_KEYCHAIN_SERVICE);
		return VALID_KEYCHAIN_BLOB;
	});
	assert.equal(creds.accessToken, "FAKE_ACCESS_TOKEN_synthetic_value_for_tests");
	assert.equal(creds.refreshToken, "FAKE_REFRESH_TOKEN_synthetic_value_for_tests");
	assert.equal(creds.expiresAt, 7258118400000);
});

test("keychain: missing item → auth_required, message has no token", async () => {
	await assert.rejects(
		() =>
			readClaudeCredentialsFromKeychain(async () => {
				throw new Error("Keychain lookup failed.");
			}),
		(err: unknown) => {
			assert.ok(isUsageError(err));
			assert.equal(err.status, "auth_required");
			assert.doesNotMatch(err.message, /FAKE_|eyJ|Bearer/);
			return true;
		},
	);
});

test("keychain: malformed item → auth_required, no leak", async () => {
	await assert.rejects(
		() => readClaudeCredentialsFromKeychain(async () => "{ SECRET_LEAK_CANARY_123 not json"),
		(err: unknown) => {
			assert.ok(isUsageError(err));
			assert.equal(err.status, "auth_required");
			assert.doesNotMatch(err.message, /SECRET_LEAK_CANARY_123/);
			return true;
		},
	);
});

test("keychain: item without an access token → auth_required", async () => {
	await assert.rejects(
		() =>
			readClaudeCredentialsFromKeychain(async () =>
				JSON.stringify({ claudeAiOauth: { refreshToken: "x" } }),
			),
		(err: unknown) => isUsageError(err) && err.status === "auth_required",
	);
});

/** Run `fn` with `$HOME` pointed at an empty temp dir, so the default credentials path is absent. */
async function withEmptyHome(fn: () => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "sdai-home-"));
	const savedHome = process.env.HOME;
	const savedUserProfile = process.env.USERPROFILE;
	process.env.HOME = dir;
	process.env.USERPROFILE = dir; // os.homedir() on Windows
	try {
		await fn();
	} finally {
		if (savedHome === undefined) delete process.env.HOME;
		else process.env.HOME = savedHome;
		if (savedUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = savedUserProfile;
		await rm(dir, { recursive: true, force: true });
	}
}

test("darwin fallback: missing default file falls back to the Keychain", async () => {
	await withEmptyHome(async () => {
		let keychainCalls = 0;
		const creds = await readClaudeCredentials(undefined, {
			platform: "darwin",
			keychainReader: async () => {
				keychainCalls += 1;
				return {
					accessToken: "FAKE_ACCESS_TOKEN_synthetic_value_for_tests",
					refreshToken: null,
					expiresAt: null,
				};
			},
		});
		assert.equal(keychainCalls, 1);
		assert.equal(creds.accessToken, "FAKE_ACCESS_TOKEN_synthetic_value_for_tests");
	});
});

test("darwin fallback: custom path set → no Keychain fallback, missing file stays an error", async () => {
	let keychainCalls = 0;
	const fake = async () => {
		keychainCalls += 1;
		return { accessToken: "x", refreshToken: null, expiresAt: null };
	};
	const missing = path.join(os.tmpdir(), "definitely-not-here-12345", ".credentials.json");
	await assert.rejects(
		() => readClaudeCredentials(missing, { platform: "darwin", keychainReader: fake }),
		(err: unknown) => isUsageError(err) && err.status === "auth_required",
	);
	assert.equal(keychainCalls, 0);
});

test("darwin fallback: non-darwin platforms never consult the Keychain", async () => {
	await withEmptyHome(async () => {
		let keychainCalls = 0;
		const fake = async () => {
			keychainCalls += 1;
			return { accessToken: "x", refreshToken: null, expiresAt: null };
		};
		await assert.rejects(
			() => readClaudeCredentials(undefined, { platform: "linux", keychainReader: fake }),
			(err: unknown) => isUsageError(err) && err.status === "auth_required",
		);
		assert.equal(keychainCalls, 0);
	});
});
