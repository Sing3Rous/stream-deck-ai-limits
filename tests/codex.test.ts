import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readCodexCredentials, jwtExpiryMs } from "../src/providers/codex/codex-credentials.ts";
import { normalizeCodexUsage } from "../src/providers/codex/codex-normalizer.ts";
import { fetchCodexUsage } from "../src/providers/codex/codex-api-client.ts";
import { CodexProvider, type CodexProviderDeps } from "../src/providers/codex/codex-provider.ts";
import { UsageCache } from "../src/cache/ttl-cache.ts";
import { isUsageError, UnauthorizedError } from "../src/utils/errors.ts";
import type { CodexUsageResponse } from "../src/providers/codex/codex-types.ts";

// --- helpers ---------------------------------------------------------------

/** Build a minimal unsigned JWT with the given `exp` (seconds). */
function fakeJwt(expSec: number | null): string {
	const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify(expSec === null ? {} : { exp: expSec })).toString("base64url");
	return `${header}.${payload}.sig`;
}

async function withTempAuth(contents: string, run: (file: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "sdai-codex-"));
	const file = path.join(dir, "auth.json");
	await writeFile(file, contents, "utf-8");
	try {
		await run(file);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const RAW: CodexUsageResponse = {
	plan_type: "plus",
	rate_limit: {
		allowed: false,
		limit_reached: true,
		primary_window: { used_percent: 35, limit_window_seconds: 18000, reset_at: 1780184777 },
		secondary_window: { used_percent: 100, limit_window_seconds: 604800, reset_at: 1780218629 },
	},
};

// --- credentials -----------------------------------------------------------

test("jwtExpiryMs decodes exp; bad token → null", () => {
	assert.equal(jwtExpiryMs(fakeJwt(1780000000)), 1780000000 * 1000);
	assert.equal(jwtExpiryMs(fakeJwt(null)), null);
	assert.equal(jwtExpiryMs("not-a-jwt"), null);
});

test("reads valid codex credentials incl. account_id and JWT expiry", async () => {
	const token = fakeJwt(1780000000);
	const auth = JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: token, account_id: "acct-123" } });
	await withTempAuth(auth, async (file) => {
		const creds = await readCodexCredentials(file);
		assert.equal(creds.accessToken, token);
		assert.equal(creds.accountId, "acct-123");
		assert.equal(creds.expiresAt, 1780000000 * 1000);
	});
});

test("missing file / no token → auth_required, no token leak", async () => {
	await assert.rejects(
		() => readCodexCredentials(path.join(os.tmpdir(), "nope-codex", "auth.json")),
		(err: unknown) => isUsageError(err) && err.status === "auth_required",
	);
	await withTempAuth(JSON.stringify({ tokens: {} }), async (file) => {
		await assert.rejects(
			() => readCodexCredentials(file),
			(err: unknown) => isUsageError(err) && err.status === "auth_required",
		);
	});
});

// --- normalizer ------------------------------------------------------------

test("normalizes primary→session (5h), secondary→weekly (7d)", () => {
	const snap = normalizeCodexUsage(RAW, undefined, new Date("2026-05-30T12:00:00Z"));
	assert.equal(snap.provider, "codex");
	assert.equal(snap.session.usedPercent, 35);
	assert.equal(snap.weekly.usedPercent, 100);
	assert.equal(snap.status, "limited"); // weekly at 100
	// reset_at seconds → ISO
	assert.equal(snap.session.resetAt, new Date(1780184777 * 1000).toISOString());
});

test("missing rate_limit → null windows, ok status, no throw", () => {
	const snap = normalizeCodexUsage({});
	assert.equal(snap.session.usedPercent, null);
	assert.equal(snap.weekly.usedPercent, null);
	assert.equal(snap.status, "ok");
});

// --- api client (mock fetch) ----------------------------------------------

async function withFetch(impl: () => Response, run: (calls: { url: string; init: RequestInit }[]) => Promise<void>) {
	const original = globalThis.fetch;
	const calls: { url: string; init: RequestInit }[] = [];
	globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return impl();
	}) as typeof fetch;
	try {
		await run(calls);
	} finally {
		globalThis.fetch = original;
	}
}

test("api client sends user-agent codex_cli_rs + account-id via a Headers object", async () => {
	await withFetch(() => new Response(JSON.stringify(RAW), { status: 200 }), async (calls) => {
		const res = await fetchCodexUsage("TOK", "acct-9");
		assert.equal(res.plan_type, "plus");
		// Must be a Headers instance — on Node 24 undici only transmits a custom UA set this way.
		const h = calls[0].init.headers;
		assert.ok(h instanceof Headers, "headers must be a Headers instance");
		assert.equal(calls[0].url, "https://chatgpt.com/backend-api/codex/usage");
		assert.equal(h.get("authorization"), "Bearer TOK");
		assert.equal(h.get("user-agent"), "codex_cli_rs");
		assert.equal(h.get("chatgpt-account-id"), "acct-9");
	});
});

test("api client status mapping: 401→Unauthorized, 403→auth, 429→rate", async () => {
	await withFetch(() => new Response("", { status: 401 }), async () => {
		await assert.rejects(() => fetchCodexUsage("T", null), (e: unknown) => e instanceof UnauthorizedError);
	});
	await withFetch(() => new Response("<html>", { status: 403 }), async () => {
		await assert.rejects(() => fetchCodexUsage("T", null), (e: unknown) => isUsageError(e) && e.status === "auth_required");
	});
	await withFetch(() => new Response("", { status: 429 }), async () => {
		await assert.rejects(() => fetchCodexUsage("T", null), (e: unknown) => isUsageError(e) && e.status === "rate_limited");
	});
});

// --- provider --------------------------------------------------------------

function makeProvider(deps: Partial<CodexProviderDeps>): CodexProvider {
	return new CodexProvider({ cache: new UsageCache({ provider: "codex" }), deps });
}

test("provider happy path → codex snapshot", async () => {
	const provider = makeProvider({
		readCredentials: async () => ({ accessToken: "T", accountId: "a", expiresAt: null }),
		fetchUsage: async (token, account) => {
			assert.equal(token, "T");
			assert.equal(account, "a");
			return RAW;
		},
	});
	const snap = await provider.getUsage();
	assert.equal(snap.provider, "codex");
	assert.equal(snap.session.usedPercent, 35);
});

test("provider: 401 → auth_required snapshot (no Codex refresh yet, no throw)", async () => {
	const provider = makeProvider({
		readCredentials: async () => ({ accessToken: "T", accountId: "a", expiresAt: null }),
		fetchUsage: async () => {
			throw new UnauthorizedError();
		},
	});
	const snap = await provider.getUsage();
	assert.equal(snap.status, "auth_required");
});

test("provider: missing credentials → auth_required snapshot", async () => {
	const { authRequired } = await import("../src/utils/errors.ts");
	const provider = makeProvider({
		readCredentials: async () => {
			throw authRequired("no creds");
		},
	});
	const snap = await provider.getUsage();
	assert.equal(snap.status, "auth_required");
});
