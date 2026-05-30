import test from "node:test";
import assert from "node:assert/strict";

import { ClaudeProvider, type ClaudeProviderDeps } from "../src/providers/claude/claude-provider.ts";
import { UsageCache } from "../src/cache/ttl-cache.ts";
import { UnauthorizedError } from "../src/providers/claude/claude-api-client.ts";
import { authRequired, genericError, rateLimited } from "../src/utils/errors.ts";
import type { ClaudeCredentials } from "../src/providers/claude/claude-credentials.ts";

const FRESH_CREDS: ClaudeCredentials = {
	accessToken: "ACCESS_FRESH",
	refreshToken: "REFRESH",
	expiresAt: Date.now() + 3_600_000,
};

const RAW = { five_hour: { utilization: 80, resets_at: "2026-05-30T15:00:00Z" }, seven_day: { utilization: 40, resets_at: "2026-06-02T00:00:00Z" } };

function makeProvider(deps: Partial<ClaudeProviderDeps>): ClaudeProvider {
	return new ClaudeProvider({
		cache: new UsageCache({ provider: "claude" }),
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

test("expired token is refreshed before the first fetch", async () => {
	let refreshed = 0;
	const provider = makeProvider({
		readCredentials: async () => ({ accessToken: "OLD", refreshToken: "R", expiresAt: Date.now() - 1000 }),
		refreshToken: async () => {
			refreshed++;
			return { accessToken: "ACCESS_NEW" };
		},
		fetchUsage: async (token) => {
			assert.equal(token, "ACCESS_NEW");
			return RAW;
		},
	});
	const snap = await provider.getUsage();
	assert.equal(refreshed, 1);
	assert.equal(snap.status, "warning");
});

test("401 triggers exactly one refresh + retry, then succeeds", async () => {
	let fetches = 0;
	let refreshed = 0;
	const provider = makeProvider({
		readCredentials: async () => FRESH_CREDS,
		refreshToken: async () => {
			refreshed++;
			return { accessToken: "ACCESS_AFTER_401" };
		},
		fetchUsage: async (token) => {
			fetches++;
			if (fetches === 1) throw new UnauthorizedError();
			assert.equal(token, "ACCESS_AFTER_401");
			return RAW;
		},
	});
	const snap = await provider.getUsage();
	assert.equal(fetches, 2);
	assert.equal(refreshed, 1);
	assert.equal(snap.status, "warning");
});

test("401 again after retry → auth_required snapshot (no throw)", async () => {
	const provider = makeProvider({
		readCredentials: async () => FRESH_CREDS,
		refreshToken: async () => ({ accessToken: "STILL_BAD" }),
		fetchUsage: async () => {
			throw new UnauthorizedError();
		},
	});
	const snap = await provider.getUsage();
	assert.equal(snap.status, "auth_required");
	assert.equal(snap.stale, false);
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

test("refresh failure during proactive refresh → auth_required snapshot", async () => {
	const provider = makeProvider({
		readCredentials: async () => ({ accessToken: "OLD", refreshToken: null, expiresAt: Date.now() - 1000 }),
		refreshToken: async () => {
			throw authRequired("no refresh token");
		},
	});
	const snap = await provider.getUsage();
	assert.equal(snap.status, "auth_required");
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

test("force bypasses the cache TTL", async () => {
	let fetches = 0;
	const provider = makeProvider({
		readCredentials: async () => FRESH_CREDS,
		fetchUsage: async () => {
			fetches++;
			return RAW;
		},
	});
	await provider.getUsage();
	await provider.getUsage({ force: true });
	assert.equal(fetches, 2);
});
