import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
	parseHostsYml,
	defaultGhHostsYmlPath,
	readGhAuthToken,
	readCopilotCredentials,
} from "../src/providers/copilot/copilot-credentials.ts";
import { isUsageError } from "../src/utils/errors.ts";

// --- helpers ---------------------------------------------------------------

async function withTempFile(contents: string, run: (file: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "sdai-copilot-"));
	const file = path.join(dir, "creds.yml");
	await writeFile(file, contents, "utf-8");
	try {
		await run(file);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Point GH_CONFIG_DIR at an (optionally pre-populated) temp dir for the gh resolution steps. */
async function withGhConfigDir(
	contents: string | null,
	run: () => Promise<void>,
): Promise<void> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "sdai-copilot-gh-"));
	if (contents !== null) {
		await writeFile(path.join(dir, "hosts.yml"), contents, "utf-8");
	}
	const prev = process.env.GH_CONFIG_DIR;
	process.env.GH_CONFIG_DIR = dir;
	try {
		await run();
	} finally {
		if (prev === undefined) {
			delete process.env.GH_CONFIG_DIR;
		} else {
			process.env.GH_CONFIG_DIR = prev;
		}
		await rm(dir, { recursive: true, force: true });
	}
}

// --- hosts.yml parsing -----------------------------------------------------

test("parseHostsYml finds the github.com oauth_token", () => {
	const contents = [
		"github.com:",
		"    oauth_token: FAKE_ACCESS_TOKEN_synthetic_value_for_tests",
		"    user: someone",
		"    git_protocol: https",
		"",
		"other.host:",
		"    oauth_token: other-token",
	].join("\n");
	assert.equal(parseHostsYml(contents), "FAKE_ACCESS_TOKEN_synthetic_value_for_tests");
});

test("parseHostsYml returns null without a github.com host", () => {
	assert.equal(parseHostsYml("enterprise.host:\n    oauth_token: tok\n"), null);
	assert.equal(parseHostsYml(""), null);
});

test("parseHostsYml returns null when github.com has no oauth_token", () => {
	assert.equal(parseHostsYml("github.com:\n    user: someone\n"), null);
});

// --- custom path -----------------------------------------------------------

test("custom path with a bare token is read", async () => {
	await withTempFile("FAKE_BARE_TOKEN_synthetic_value_for_tests\n", async (file) => {
		const creds = await readCopilotCredentials(file);
		assert.equal(creds.accessToken, "FAKE_BARE_TOKEN_synthetic_value_for_tests");
	});
});

test("custom path with a hosts.yml-style file is parsed", async () => {
	await withTempFile("github.com:\n    oauth_token: FAKE_YML_TOKEN_synthetic_value\n", async (file) => {
		const creds = await readCopilotCredentials(file);
		assert.equal(creds.accessToken, "FAKE_YML_TOKEN_synthetic_value");
	});
});

test("missing custom file → auth_required, no token leak", async () => {
	const missing = path.join(os.tmpdir(), "definitely-not-here-copilot-12345", "creds.yml");
	await assert.rejects(
		() => readCopilotCredentials(missing),
		(err: unknown) => {
			assert.ok(isUsageError(err));
			assert.equal(err.status, "auth_required");
			assert.doesNotMatch(err.message, /FAKE_|eyJ|Bearer/);
			return true;
		},
	);
});

test("malformed custom file (multi-line) → auth_required", async () => {
	await withTempFile("FAKE_ONE_token\nFAKE_TWO_token\n", async (file) => {
		await assert.rejects(
			() => readCopilotCredentials(file),
			(err: unknown) => isUsageError(err) && err.status === "auth_required",
		);
	});
});

test("custom file token never leaks into error messages", async () => {
	await withTempFile("SECRET_LEAK_CANARY_123 with spaces inside\n", async (file) => {
		await assert.rejects(
			() => readCopilotCredentials(file),
			(err: unknown) => {
				assert.ok(isUsageError(err));
				assert.doesNotMatch(err.message, /SECRET_LEAK_CANARY_123/);
				return true;
			},
		);
	});
});

// --- gh resolution chain ---------------------------------------------------

test("gh hosts.yml token is used before the gh subprocess", async () => {
	await withGhConfigDir("github.com:\n    oauth_token: FAKE_HOSTS_TOKEN_synthetic_value\n", async () => {
		const creds = await readCopilotCredentials(undefined, async () => {
			throw new Error("gh subprocess must not run when hosts.yml has a token");
		});
		assert.equal(creds.accessToken, "FAKE_HOSTS_TOKEN_synthetic_value");
	});
});

test("gh subprocess failure → auth_required, no token leak", async () => {
	await withGhConfigDir(null, async () => {
		await assert.rejects(
			() =>
				readCopilotCredentials(undefined, async () => {
					throw new Error("SECRET_LEAK_CANARY_123 gh exploded");
				}),
			(err: unknown) => {
				assert.ok(isUsageError(err));
				assert.equal(err.status, "auth_required");
				assert.doesNotMatch(err.message, /SECRET_LEAK_CANARY_123/);
				assert.doesNotMatch(err.message, /FAKE_|eyJ|Bearer/);
				return true;
			},
		);
	});
});

test("gh auth token success (injected) is returned", async () => {
	await withGhConfigDir(null, async () => {
		const creds = await readCopilotCredentials(undefined, async () => "FAKE_GH_TOKEN_synthetic_value");
		assert.equal(creds.accessToken, "FAKE_GH_TOKEN_synthetic_value");
	});
});

test("gh auth token targets github.com with a hidden, shell-free five-second subprocess", async () => {
	let captured: { file: string; args: readonly string[]; options: object } | undefined;
	const token = await readGhAuthToken(async (file, args, options) => {
		captured = { file, args, options };
		return { stdout: "FAKE_GH_TOKEN_synthetic_value\n" };
	});
	assert.equal(token, "FAKE_GH_TOKEN_synthetic_value");
	assert.deepEqual(captured, {
		file: "gh",
		args: ["auth", "token", "--hostname", "github.com"],
		options: { shell: false, timeout: 5_000, windowsHide: true },
	});
});

test("gh empty token → auth_required", async () => {
	await withGhConfigDir(null, async () => {
		await assert.rejects(
			() => readCopilotCredentials(undefined, async () => "   \n"),
			(err: unknown) => isUsageError(err) && err.status === "auth_required",
		);
	});
});

// --- path resolution -------------------------------------------------------

test("defaultGhHostsYmlPath honors GH_CONFIG_DIR", () => {
	const prev = process.env.GH_CONFIG_DIR;
	process.env.GH_CONFIG_DIR = path.join(os.tmpdir(), "gh-config-test");
	try {
		assert.equal(
			defaultGhHostsYmlPath(),
			path.join(os.tmpdir(), "gh-config-test", "hosts.yml"),
		);
	} finally {
		if (prev === undefined) {
			delete process.env.GH_CONFIG_DIR;
		} else {
			process.env.GH_CONFIG_DIR = prev;
		}
	}
});

test("defaultGhHostsYmlPath ends with hosts.yml without GH_CONFIG_DIR", () => {
	const prev = process.env.GH_CONFIG_DIR;
	delete process.env.GH_CONFIG_DIR;
	try {
		assert.match(defaultGhHostsYmlPath(), /[\\/]hosts\.yml$/);
	} finally {
		if (prev !== undefined) {
			process.env.GH_CONFIG_DIR = prev;
		}
	}
});
