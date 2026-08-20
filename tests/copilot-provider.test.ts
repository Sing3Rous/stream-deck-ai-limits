import test from "node:test";
import assert from "node:assert/strict";

import { UsageCache } from "../src/cache/ttl-cache.ts";
import { UnauthorizedError } from "../src/providers/copilot/copilot-api-client.ts";
import { CopilotProvider, type CopilotProviderDeps } from "../src/providers/copilot/copilot-provider.ts";
import { authRequired } from "../src/utils/errors.ts";

const RAW = { quota_reset_date_utc: "2026-09-01T00:00:00Z", quota_snapshots: { premium_interactions: { percent_remaining: 75 } } };

function provider(deps: Partial<CopilotProviderDeps>): CopilotProvider {
	return new CopilotProvider({ cache: new UsageCache({ provider: "copilot", forceMinIntervalMs: 0 }), deps });
}

test("Copilot provider normalizes a successful premium quota response", async () => {
	const result = await provider({ readCredentials: async () => ({ accessToken: "FIRST" }), fetchUsage: async () => RAW }).getUsage();
	assert.equal(result.session.usedPercent, 25);
	assert.equal(result.session.resetAt, "2026-09-01T00:00:00.000Z");
});

test("Copilot provider re-reads credentials and retries exactly once after 401", async () => {
	let reads = 0, fetches = 0;
	const result = await provider({
		readCredentials: async () => ({ accessToken: ++reads === 1 ? "OLD" : "NEW" }),
		fetchUsage: async (token) => { if (++fetches === 1) throw new UnauthorizedError(); assert.equal(token, "NEW"); return RAW; },
	}).getUsage();
	assert.equal(result.status, "ok");
	assert.equal(reads, 2);
	assert.equal(fetches, 2);
});

test("repeated Copilot 401 and credential errors become auth_required snapshots", async () => {
	const repeated = await provider({ readCredentials: async () => ({ accessToken: "BAD" }), fetchUsage: async () => { throw new UnauthorizedError(); } }).getUsage();
	assert.equal(repeated.status, "auth_required");
	const missing = await provider({ readCredentials: async () => { throw authRequired("credentials unavailable"); } }).getUsage();
	assert.equal(missing.status, "auth_required");
	assert.match(missing.errorMessage ?? "", /credentials unavailable/);
});

test("Copilot provider reuses its cache within the TTL", async () => {
	let fetches = 0;
	const p = provider({ readCredentials: async () => ({ accessToken: "TOKEN" }), fetchUsage: async () => { fetches++; return RAW; } });
	await p.getUsage();
	await p.getUsage();
	assert.equal(fetches, 1);
});
