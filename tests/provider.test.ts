import test, { beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import { ClaudeProvider, type ClaudeProviderDeps } from "../src/providers/claude/claude-provider.ts";
import { UsageCache } from "../src/cache/ttl-cache.ts";
import { UnauthorizedError } from "../src/providers/claude/claude-api-client.ts";
import { authRequired, genericError, rateLimited } from "../src/utils/errors.ts";
import type { ClaudeCredentials } from "../src/providers/claude/claude-credentials.ts";

// Provider tests must never contact OAuth or usage endpoints, even if renewal regresses.
beforeEach(() => {
	mock.method(globalThis, "fetch", async () => {
		assert.fail("Claude provider must not call OAuth; usage is injected in these tests");
	});
});
afterEach(() => mock.restoreAll());

const FRESH_CREDS: ClaudeCredentials = {
	accessToken: "ACCESS_FRESH",
	refreshToken: "REFRESH",
	expiresAt: Date.now() + 3_600_000,
};

const RAW = { five_hour: { utilization: 80, resets_at: "2026-05-30T15:00:00Z" }, seven_day: { utilization: 40, resets_at: "2026-06-02T00:00:00Z" } };

function makeProvider(deps: Partial<ClaudeProviderDeps>, cacheOpts?: { forceMinIntervalMs?: number }): ClaudeProvider {
	return new ClaudeProvider({
		cache: new UsageCache({ provider: "claude", ...cacheOpts }),
		deps,
	});
}

test("happy path: reads creds, fetches, normalizes to a snapshot", async () => {
	const provider = makeProvider({
		readCredentials: async () => FRESH_CREDS,
		fetchUsage: async (token) => {
			assert.equal(token, "ACCESS_FRESH");
			return RAW;
		},
	});
	const snap = await provider.getUsage();
	assert.equal(snap.session.usedPercent, 80);
	assert.equal(snap.weekly.usedPercent, 40);
	assert.equal(snap.status, "warning");
});

test("expired shared credentials never make a request or consume a refresh token", async () => {
	const credentials = { accessToken: "OLD", refreshToken: "SHARED_REFRESH", expiresAt: 1 };
	const provider = makeProvider({
		readCredentials: async () => ({ ...credentials }),
		fetchUsage: async () => { assert.fail("Expired credentials must not reach the network"); },
	});
	const snapshot = await provider.getUsage();
	assert.equal(snapshot.status, "auth_required");
	assert.match(snapshot.errorMessage!, /Open Claude Code/);
	assert.equal(credentials.refreshToken, "SHARED_REFRESH");
});

test("401 does not refresh or retry; a later poll recovers after CLI renewal", async () => {
	let credentials = { ...FRESH_CREDS };
	let requests = 0;
	const provider = makeProvider({
		readCredentials: async () => ({ ...credentials }),
		fetchUsage: async (token) => {
			requests++;
			if (token === FRESH_CREDS.accessToken) throw new UnauthorizedError();
			assert.equal(token, "CLI_RENEWED");
			return RAW;
		},
	}, { forceMinIntervalMs: 0 });
	assert.equal((await provider.getUsage()).status, "auth_required");
	assert.equal(requests, 1);
	credentials = { ...FRESH_CREDS, accessToken: "CLI_RENEWED" };
	assert.equal((await provider.getUsage({ force: true })).status, "warning");
	assert.equal(requests, 2);
});

test("expired credentials preserve stale usage, then recover after CLI renewal", async () => {
	let credentials = { ...FRESH_CREDS };
	let requests = 0;
	const provider = makeProvider({
		readCredentials: async () => ({ ...credentials }),
		fetchUsage: async () => { requests++; return RAW; },
	}, { forceMinIntervalMs: 0 });
	assert.equal((await provider.getUsage()).status, "warning");
	credentials = { ...credentials, expiresAt: 1 };
	const stale = await provider.getUsage({ force: true });
	assert.equal(stale.status, "stale");
	assert.equal(stale.stale, true);
	assert.equal(stale.session.usedPercent, 80);
	assert.equal(requests, 1);
	credentials = { ...FRESH_CREDS, accessToken: "CLI_RENEWED" };
	assert.equal((await provider.getUsage({ force: true })).status, "warning");
	assert.equal(requests, 2);
});

test("missing credentials → auth_required snapshot (no throw)", async () => {
	const provider = makeProvider({
		readCredentials: async () => {
			throw authRequired("no creds");
		},
	});
	const snap = await provider.getUsage();
	assert.equal(snap.status, "auth_required");
});

test("rate limited → rate_limited snapshot", async () => {
	const provider = makeProvider({
		readCredentials: async () => FRESH_CREDS,
		fetchUsage: async () => {
			throw rateLimited("429");
		},
	});
	const snap = await provider.getUsage();
	assert.equal(snap.status, "rate_limited");
});

test("network error → error snapshot", async () => {
	const provider = makeProvider({
		readCredentials: async () => FRESH_CREDS,
		fetchUsage: async () => {
			throw genericError("network down");
		},
	});
	const snap = await provider.getUsage();
	assert.equal(snap.status, "error");
});

test("second call within TTL is served from cache (one fetch)", async () => {
	let fetches = 0;
	const provider = makeProvider({
		readCredentials: async () => FRESH_CREDS,
		fetchUsage: async () => {
			fetches++;
			return RAW;
		},
	});
	await provider.getUsage();
	await provider.getUsage();
	assert.equal(fetches, 1);
});

test("force bypasses the cache TTL (throttle disabled)", async () => {
	let fetches = 0;
	const provider = makeProvider(
		{
			readCredentials: async () => FRESH_CREDS,
			fetchUsage: async () => {
				fetches++;
				return RAW;
			},
		},
		{ forceMinIntervalMs: 0 },
	);
	await provider.getUsage();
	await provider.getUsage({ force: true });
	assert.equal(fetches, 2);
});

test("rapid forced presses are throttled (default 10s)", async () => {
	let fetches = 0;
	const provider = makeProvider({
		readCredentials: async () => FRESH_CREDS,
		fetchUsage: async () => {
			fetches++;
			return RAW;
		},
	});
	await provider.getUsage(); // 1 real fetch
	await provider.getUsage({ force: true }); // within 10s → throttled
	await provider.getUsage({ force: true }); // within 10s → throttled
	assert.equal(fetches, 1);
});
