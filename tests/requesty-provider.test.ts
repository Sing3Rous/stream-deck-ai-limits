import test from "node:test";
import assert from "node:assert/strict";

import { UsageCache } from "../src/cache/ttl-cache.ts";
import { DEFAULT_REQUESTY_THRESHOLDS } from "../src/providers/types.ts";
import { UnauthorizedError } from "../src/providers/requesty/requesty-api-client.ts";
import {
	RequestyProvider,
	type RequestyProviderDeps,
} from "../src/providers/requesty/requesty-provider.ts";
import { authRequired, genericError } from "../src/utils/errors.ts";

const NOW = new Date("2026-08-31T12:00:00Z");
const ORG = { name: "Test Org", balance: 50 };
const USAGE = {
	usage: { [new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()]: { spend: 0.1 } },
};

function provider(deps: Partial<RequestyProviderDeps>): RequestyProvider {
	return new RequestyProvider({
		cache: new UsageCache({ provider: "requesty", forceMinIntervalMs: 0 }),
		deps: { now: () => NOW.getTime(), ...deps },
	});
}

test("Requesty provider normalizes a successful org + usage response", async () => {
	const result = await provider({
		readCredentials: async () => ({ apiKey: "KEY", source: "env" }),
		fetchOrg: async () => ORG,
		fetchUsage: async () => USAGE,
	}).getUsage();
	assert.equal(result.status, "ok");
	assert.equal(result.provider, "requesty");
	assert.equal(result.requesty?.balanceUsd, 50);
	assert.equal(result.requesty?.spend24hUsd, 0.1);
	assert.equal(result.requesty?.spend7dUsd, 0.1);
	assert.deepEqual(result.requesty?.thresholds, DEFAULT_REQUESTY_THRESHOLDS);
	assert.equal(result.session.usedPercent, null);
	assert.equal(result.session.resetAt, null);
	assert.equal(result.updatedAt, "2026-08-31T12:00:00.000Z");
	assert.equal(result.stale, false);
});

test("usage 401 triggers one credential re-read and one retry, then succeeds", async () => {
	let reads = 0;
	let orgFetches = 0;
	let usageFetches = 0;
	const result = await provider({
		readCredentials: async () => ({ apiKey: ++reads === 1 ? "OLD" : "NEW", source: "env" }),
		fetchOrg: async () => {
			orgFetches++;
			return ORG;
		},
		fetchUsage: async (token) => {
			usageFetches++;
			if (usageFetches === 1) {
				throw new UnauthorizedError();
			}
			assert.equal(token, "NEW");
			return USAGE;
		},
	}).getUsage();
	assert.equal(result.status, "ok");
	assert.equal(reads, 2);
	assert.equal(orgFetches, 1);
	assert.equal(usageFetches, 2);
});

test("org 401 also triggers one credential re-read and one retry, then succeeds", async () => {
	let reads = 0;
	let orgFetches = 0;
	let usageFetches = 0;
	const result = await provider({
		readCredentials: async () => ({ apiKey: ++reads === 1 ? "OLD" : "NEW", source: "env" }),
		fetchOrg: async (token) => {
			orgFetches++;
			if (orgFetches === 1) {
				throw new UnauthorizedError();
			}
			assert.equal(token, "NEW");
			return ORG;
		},
		fetchUsage: async () => {
			usageFetches++;
			return USAGE;
		},
	}).getUsage();
	assert.equal(result.status, "ok");
	assert.equal(reads, 2);
	assert.equal(orgFetches, 2);
	assert.equal(usageFetches, 1);
});

test("repeated Requesty 401 and credential errors become auth_required snapshots", async () => {
	const repeated = await provider({
		readCredentials: async () => ({ apiKey: "BAD", source: "env" }),
		fetchOrg: async () => ORG,
		fetchUsage: async () => {
			throw new UnauthorizedError();
		},
	}).getUsage();
	assert.equal(repeated.status, "auth_required");
	assert.match(repeated.errorMessage ?? "", /rejected/i);

	const missing = await provider({
		readCredentials: async () => {
			throw authRequired("credentials unavailable");
		},
		fetchOrg: async () => ORG,
		fetchUsage: async () => USAGE,
	}).getUsage();
	assert.equal(missing.status, "auth_required");
	assert.match(missing.errorMessage ?? "", /credentials unavailable/);
});

test("UsageError becomes an error snapshot through the real cache", async () => {
	const result = await provider({
		readCredentials: async () => ({ apiKey: "KEY", source: "env" }),
		fetchOrg: async () => ORG,
		fetchUsage: async () => {
			throw genericError("boom");
		},
	}).getUsage();
	assert.equal(result.status, "error");
	assert.match(result.errorMessage ?? "", /boom/);
});

test("Requesty provider reuses its cache within the TTL", async () => {
	let orgFetches = 0;
	const p = provider({
		readCredentials: async () => ({ apiKey: "KEY", source: "env" }),
		fetchOrg: async () => {
			orgFetches++;
			return ORG;
		},
		fetchUsage: async () => USAGE,
	});
	await p.getUsage();
	await p.getUsage();
	assert.equal(orgFetches, 1);
});

test("serves a stale snapshot after a failed refresh", async () => {
	let fail = false;
	const p = provider({
		readCredentials: async () => ({ apiKey: "KEY", source: "env" }),
		fetchOrg: async () => {
			if (fail) {
				throw genericError("boom");
			}
			return ORG;
		},
		fetchUsage: async () => USAGE,
	});

	const first = await p.getUsage();
	assert.equal(first.status, "ok");

	fail = true;
	const stale = await p.getUsage({ force: true });
	assert.equal(stale.status, "stale");
	assert.equal(stale.stale, true);
	assert.equal(stale.staleReason, "error");
	assert.equal(stale.requesty?.balanceUsd, 50); // last-known-good data preserved
});
