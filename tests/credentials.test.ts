import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
	readClaudeCredentials,
	isExpired,
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

const KEYCHAIN_BLOB = JSON.stringify({
	claudeAiOauth: {
		accessToken: "FAKE_KEYCHAIN_ACCESS_TOKEN",
		refreshToken: "FAKE_KEYCHAIN_REFRESH_TOKEN",
		expiresAt: 7258118400000,
	},
});

/** The default path, guaranteed absent, so the Keychain fallback is what gets exercised. */
async function withoutDefaultCredentialsFile(run: () => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "sdai-home-"));
	const realHomedir = os.homedir;
	Object.defineProperty(os, "homedir", { value: () => dir, configurable: true });
	try {
		await run();
	} finally {
		Object.defineProperty(os, "homedir", { value: realHomedir, configurable: true });
		await rm(dir, { recursive: true, force: true });
	}
}

test("macOS: missing default file falls back to the Keychain", async (t) => {
	if (process.platform !== "darwin") {
		t.skip("Keychain fallback is macOS-only");
		return;
	}
	await withoutDefaultCredentialsFile(async () => {
		const creds = await readClaudeCredentials(undefined, async () => KEYCHAIN_BLOB);
		assert.equal(creds.accessToken, "FAKE_KEYCHAIN_ACCESS_TOKEN");
		assert.equal(creds.refreshToken, "FAKE_KEYCHAIN_REFRESH_TOKEN");
		assert.equal(creds.expiresAt, 7258118400000);
	});
});

test("macOS: empty Keychain → auth_required", async (t) => {
	if (process.platform !== "darwin") {
		t.skip("Keychain fallback is macOS-only");
		return;
	}
	await withoutDefaultCredentialsFile(async () => {
		await assert.rejects(
			() => readClaudeCredentials(undefined, async () => null),
			(err: unknown) => isUsageError(err) && err.status === "auth_required",
		);
	});
});

test("an explicit custom path never consults the Keychain", async () => {
	const missing = path.join(os.tmpdir(), "definitely-not-here-12345", ".credentials.json");
	let consulted = false;
	await assert.rejects(
		() =>
			readClaudeCredentials(missing, async () => {
				consulted = true;
				return KEYCHAIN_BLOB;
			}),
		(err: unknown) => isUsageError(err) && err.status === "auth_required",
	);
	assert.equal(consulted, false, "custom path must be taken at face value");
});

test("malformed Keychain blob → auth_required without leaking it", async (t) => {
	if (process.platform !== "darwin") {
		t.skip("Keychain fallback is macOS-only");
		return;
	}
	await withoutDefaultCredentialsFile(async () => {
		await assert.rejects(
			() => readClaudeCredentials(undefined, async () => '{"claudeAiOauth":{"accessToken":"KC_CANARY'),
			(err: unknown) => {
				assert.ok(isUsageError(err));
				assert.doesNotMatch(err.message, /KC_CANARY/);
				return true;
			},
		);
	});
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
