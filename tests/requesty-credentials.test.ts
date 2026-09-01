import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
	readRequestyCredentials,
	requestyCredentialScope,
	type RequestyFileReader,
} from "../src/providers/requesty/requesty-credentials.ts";
import { defaultRequestyCredentialsPath, resolveRequestyCredentialsPath } from "../src/utils/paths.ts";
import { isUsageError } from "../src/utils/errors.ts";

// --- helpers ---------------------------------------------------------------

async function withTempFile(contents: string, run: (file: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "sdai-requesty-"));
	const file = path.join(dir, "api-key");
	await writeFile(file, contents, "utf-8");
	try {
		await run(file);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// --- env helpers -----------------------------------------------------------

function withEnv(value: string | null, run: () => Promise<void>): Promise<void> {
	const prev = process.env.REQUESTY_API_KEY;
	if (value === null) {
		delete process.env.REQUESTY_API_KEY;
	} else {
		process.env.REQUESTY_API_KEY = value;
	}
	return Promise.resolve()
		.then(run)
		.finally(() => {
			if (prev === undefined) {
				delete process.env.REQUESTY_API_KEY;
			} else {
				process.env.REQUESTY_API_KEY = prev;
			}
		});
}

// --- custom path -----------------------------------------------------------

test("custom path with a bare token is read and wins over env", async () => {
	await withTempFile("FAKE_CUSTOM_KEY_synthetic_value_for_tests\n", async (file) => {
		await withEnv("FAKE_ENV_KEY_synthetic_value", async () => {
			const creds = await readRequestyCredentials(file);
			assert.equal(creds.apiKey, "FAKE_CUSTOM_KEY_synthetic_value_for_tests");
			assert.equal(creds.source, "custom");
		});
	});
});

test("missing custom file falls through to the env var", async () => {
	const missing = path.join(os.tmpdir(), "definitely-not-here-requesty-12345", "api-key");
	await withEnv("FAKE_ENV_KEY_synthetic_value", async () => {
		const creds = await readRequestyCredentials(missing);
		assert.equal(creds.apiKey, "FAKE_ENV_KEY_synthetic_value");
		assert.equal(creds.source, "env");
	});
});

test("missing custom file falls through to the default file", async () => {
	const missing = path.join(os.tmpdir(), "definitely-not-here-requesty-67890", "api-key");
	const resolvedMissing = resolveRequestyCredentialsPath(missing);
	const reader: RequestyFileReader = async (filePath) => {
		if (filePath === resolvedMissing) {
			throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" });
		}
		assert.equal(filePath, defaultRequestyCredentialsPath());
		return "FAKE_DEFAULT_KEY_synthetic_value\n";
	};
	await withEnv(null, async () => {
		const creds = await readRequestyCredentials(missing, reader);
		assert.equal(creds.apiKey, "FAKE_DEFAULT_KEY_synthetic_value");
		assert.equal(creds.source, "default");
	});
});

test("malformed custom file (multi-line) → auth_required", async () => {
	await withTempFile("FAKE_ONE_token\nFAKE_TWO_token\n", async (file) => {
		await assert.rejects(
			() => readRequestyCredentials(file),
			(err: unknown) => isUsageError(err) && err.status === "auth_required",
		);
	});
});

test("whitespace-only custom file → auth_required", async () => {
	await withTempFile("   \n\t\n", async (file) => {
		await assert.rejects(
			() => readRequestyCredentials(file),
			(err: unknown) => isUsageError(err) && err.status === "auth_required",
		);
	});
});

test("custom file key never leaks into error messages", async () => {
	await withTempFile("SECRET_LEAK_CANARY_123 with spaces inside\n", async (file) => {
		await assert.rejects(
			() => readRequestyCredentials(file),
			(err: unknown) => {
				assert.ok(isUsageError(err));
				assert.equal(err.status, "auth_required");
				assert.doesNotMatch(err.message, /SECRET_LEAK_CANARY_123/);
				return true;
			},
		);
	});
});

// --- env var ---------------------------------------------------------------

test("env var is used when no custom path is given", async () => {
	await withEnv("FAKE_ENV_KEY_synthetic_value", async () => {
		const creds = await readRequestyCredentials();
		assert.equal(creds.apiKey, "FAKE_ENV_KEY_synthetic_value");
		assert.equal(creds.source, "env");
	});
});

test("env var wins over an existing default file", async () => {
	const reader: RequestyFileReader = async (filePath) => {
		assert.equal(filePath, defaultRequestyCredentialsPath());
		return "FAKE_DEFAULT_KEY_synthetic_value\n";
	};
	await withEnv("FAKE_ENV_KEY_synthetic_value", async () => {
		const creds = await readRequestyCredentials(undefined, reader);
		assert.equal(creds.apiKey, "FAKE_ENV_KEY_synthetic_value");
		assert.equal(creds.source, "env");
	});
});

test("whitespace-only env var is ignored", async () => {
	const reader: RequestyFileReader = async (filePath) => {
		assert.equal(filePath, defaultRequestyCredentialsPath());
		return "FAKE_DEFAULT_KEY_synthetic_value\n";
	};
	await withEnv("   \n", async () => {
		const creds = await readRequestyCredentials(undefined, reader);
		assert.equal(creds.apiKey, "FAKE_DEFAULT_KEY_synthetic_value");
		assert.equal(creds.source, "default");
	});
});

// --- default file ----------------------------------------------------------

test("default file via injected path is used when nothing else resolves", async () => {
	const reader: RequestyFileReader = async (filePath) => {
		assert.equal(filePath, defaultRequestyCredentialsPath());
		return "FAKE_DEFAULT_KEY_synthetic_value\n";
	};
	await withEnv(null, async () => {
		const creds = await readRequestyCredentials(undefined, reader);
		assert.equal(creds.apiKey, "FAKE_DEFAULT_KEY_synthetic_value");
		assert.equal(creds.source, "default");
	});
});

test("malformed default file → auth_required", async () => {
	const reader: RequestyFileReader = async () => "FAKE_ONE_token\nFAKE_TWO_token\n";
	await withEnv(null, async () => {
		await assert.rejects(
			() => readRequestyCredentials(undefined, reader),
			(err: unknown) => isUsageError(err) && err.status === "auth_required",
		);
	});
});

// --- everything missing ----------------------------------------------------

// --- credential scope --------------------------------------------------------

test("requestyCredentialScope: custom path → custom:<resolved absolute>", async () => {
	await withTempFile("FAKE_CUSTOM_KEY_synthetic_value_for_tests\n", async (file) => {
		await withEnv("FAKE_ENV_KEY_synthetic_value", async () => {
			assert.equal(requestyCredentialScope(file), `custom:${resolveRequestyCredentialsPath(file)}`);
		});
	});
});

test("requestyCredentialScope: env is used when no custom path is set", async () => {
	await withEnv("FAKE_ENV_KEY_synthetic_value", async () => {
		assert.equal(requestyCredentialScope(), "env");
	});
});

test("requestyCredentialScope: whitespace custom path falls through to env", async () => {
	await withEnv("FAKE_ENV_KEY_synthetic_value", async () => {
		assert.equal(requestyCredentialScope("   "), "env");
	});
});

test("requestyCredentialScope: nothing resolves → default", async () => {
	await withEnv(null, async () => {
		assert.equal(requestyCredentialScope(), "default");
		assert.equal(requestyCredentialScope(undefined), "default");
	});
});

test("missing everything → auth_required with the setup hint, no key leak", async () => {
	const defaultPath = path.join(os.tmpdir(), "sdai-requesty-nokey-", "api-key");
	const reader: RequestyFileReader = async () => {
		throw Object.assign(new Error(`ENOENT: ${defaultPath}`), { code: "ENOENT" });
	};
	await withEnv(null, async () => {
		await assert.rejects(
			() => readRequestyCredentials(undefined, reader),
			(err: unknown) => {
				assert.ok(isUsageError(err));
				assert.equal(err.status, "auth_required");
				assert.match(err.message, /REQUESTY_API_KEY|\.requesty\/api-key/);
				assert.doesNotMatch(err.message, /FAKE_|eyJ|Bearer/);
				return true;
			},
		);
	});
});
