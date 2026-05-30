import test from "node:test";
import assert from "node:assert/strict";

import { UsageCache, DEFAULT_TTL_MS, DEFAULT_FORCE_MIN_INTERVAL_MS } from "../src/cache/ttl-cache.ts";
import { rateLimited, genericError } from "../src/utils/errors.ts";
import type { UsageSnapshot } from "../src/providers/types.ts";

function okSnapshot(session = 50, weekly = 30): UsageSnapshot {
	return {
		provider: "claude",
		session: { usedPercent: session, resetAt: null },
		weekly: { usedPercent: weekly, resetAt: null },
		status: "ok",
		updatedAt: "2026-05-30T00:00:00.000Z",
		stale: false,
	};
}

/** A mutable clock for deterministic TTL tests. */
function clock(start = 1_000_000) {
	let t = start;
	return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("first get triggers a fetch and stores the snapshot", async () => {
	const cache = new UsageCache({ provider: "claude" });
	let calls = 0;
	const snap = await cache.get(async () => {
		calls++;
		return okSnapshot(42);
	});
	assert.equal(calls, 1);
	assert.equal(snap.session.usedPercent, 42);
	assert.equal(cache.lastSnapshot?.session.usedPercent, 42);
});

test("within TTL, a second get serves cache without fetching", async () => {
	const c = clock();
	const cache = new UsageCache({ provider: "claude", now: c.now });
	let calls = 0;
	const fetcher = async () => {
		calls++;
		return okSnapshot(calls);
	};
	await cache.get(fetcher);
	c.advance(DEFAULT_TTL_MS - 1);
	const second = await cache.get(fetcher);
	assert.equal(calls, 1);
	assert.equal(second.session.usedPercent, 1);
});

test("after TTL expires, get fetches again", async () => {
	const c = clock();
	const cache = new UsageCache({ provider: "claude", now: c.now });
	let calls = 0;
	const fetcher = async () => {
		calls++;
		return okSnapshot(calls);
	};
	await cache.get(fetcher);
	c.advance(DEFAULT_TTL_MS + 1);
	const second = await cache.get(fetcher);
	assert.equal(calls, 2);
	assert.equal(second.session.usedPercent, 2);
});

test("force bypasses a fresh TTL once past the force throttle", async () => {
	const c = clock();
	const cache = new UsageCache({ provider: "claude", now: c.now });
	let calls = 0;
	const fetcher = async () => {
		calls++;
		return okSnapshot(calls);
	};
	await cache.get(fetcher);
	c.advance(DEFAULT_FORCE_MIN_INTERVAL_MS + 1); // clear the force throttle
	const forced = await cache.get(fetcher, { force: true });
	assert.equal(calls, 2);
	assert.equal(forced.session.usedPercent, 2);
});

test("force within the throttle window re-serves cache without fetching", async () => {
	const c = clock();
	const cache = new UsageCache({ provider: "claude", now: c.now });
	let calls = 0;
	const fetcher = async () => {
		calls++;
		return okSnapshot(calls);
	};
	await cache.get(fetcher); // calls=1
	c.advance(DEFAULT_FORCE_MIN_INTERVAL_MS - 1);
	const r1 = await cache.get(fetcher, { force: true }); // throttled → no fetch
	const r2 = await cache.get(fetcher, { force: true }); // throttled → no fetch
	assert.equal(calls, 1, "rapid forced presses do not hit the network");
	assert.equal(r1.session.usedPercent, 1);
	assert.equal(r2.session.usedPercent, 1);
});

test("concurrent gets share a single in-flight fetch (dedupe)", async () => {
	const cache = new UsageCache({ provider: "claude" });
	let calls = 0;
	let resolve!: (s: UsageSnapshot) => void;
	const fetcher = () => {
		calls++;
		return new Promise<UsageSnapshot>((r) => (resolve = r));
	};
	const p1 = cache.get(fetcher);
	const p2 = cache.get(fetcher);
	const p3 = cache.get(fetcher);
	resolve(okSnapshot(7));
	const results = await Promise.all([p1, p2, p3]);
	assert.equal(calls, 1);
	for (const r of results) assert.equal(r.session.usedPercent, 7);
});

test("error after a good fetch returns the last snapshot marked stale", async () => {
	const c = clock();
	const cache = new UsageCache({ provider: "claude", now: c.now });
	await cache.get(async () => okSnapshot(88));
	c.advance(DEFAULT_TTL_MS + 1);
	const stale = await cache.get(async () => {
		throw genericError("network down");
	});
	assert.equal(stale.status, "stale");
	assert.equal(stale.stale, true);
	assert.equal(stale.session.usedPercent, 88); // last good numbers preserved
});

test("error with no prior snapshot returns an error snapshot", async () => {
	const cache = new UsageCache({ provider: "claude" });
	const result = await cache.get(async () => {
		throw genericError("boom");
	});
	assert.equal(result.status, "error");
	assert.equal(result.stale, false);
	assert.equal(result.session.usedPercent, null);
});

test("429 triggers backoff: subsequent gets serve stale without fetching", async () => {
	const c = clock();
	const cache = new UsageCache({ provider: "claude", now: c.now, rateLimitBackoffMs: 300_000 });
	await cache.get(async () => okSnapshot(60)); // seed a good snapshot
	c.advance(DEFAULT_TTL_MS + 1);

	let calls = 0;
	// First post-TTL fetch hits 429.
	const limited = await cache.get(async () => {
		calls++;
		throw rateLimited("429");
	});
	assert.equal(calls, 1);
	assert.equal(limited.status, "stale"); // we had a prior snapshot → stale, not rate_limited

	// Within backoff window + forced → must NOT hit the network.
	c.advance(60_000);
	const during = await cache.get(async () => {
		calls++;
		return okSnapshot(99);
	}, { force: true });
	assert.equal(calls, 1, "no network call during backoff");
	assert.equal(during.status, "stale");

	// After backoff window → fetches again.
	c.advance(300_000);
	const after = await cache.get(async () => {
		calls++;
		return okSnapshot(70);
	});
	assert.equal(calls, 2);
	assert.equal(after.session.usedPercent, 70);
});

test("429 with no prior snapshot returns a rate_limited snapshot", async () => {
	const cache = new UsageCache({ provider: "claude" });
	const result = await cache.get(async () => {
		throw rateLimited("429");
	});
	assert.equal(result.status, "rate_limited");
});

test("stale after a 429 is tagged with staleReason 'rate_limited'", async () => {
	const c = clock();
	const cache = new UsageCache({ provider: "claude", now: c.now });
	await cache.get(async () => okSnapshot(60));
	c.advance(DEFAULT_TTL_MS + 1);
	const stale = await cache.get(async () => {
		throw rateLimited("429");
	});
	assert.equal(stale.status, "stale");
	assert.equal(stale.staleReason, "rate_limited");
});

test("stale after a generic error is tagged with staleReason 'error'", async () => {
	const c = clock();
	const cache = new UsageCache({ provider: "claude", now: c.now });
	await cache.get(async () => okSnapshot(60));
	c.advance(DEFAULT_TTL_MS + 1);
	const stale = await cache.get(async () => {
		throw genericError("down");
	});
	assert.equal(stale.staleReason, "error");
});

test("honors Retry-After: backoff ends after the server-specified delay", async () => {
	const c = clock();
	// Big default backoff so we can prove Retry-After (shorter) is what's used.
	const cache = new UsageCache({ provider: "claude", now: c.now, rateLimitBackoffMs: 600_000 });
	await cache.get(async () => okSnapshot(60));
	c.advance(DEFAULT_TTL_MS + 1);

	let calls = 0;
	await cache.get(async () => {
		calls++;
		throw rateLimited("429", 72_000); // server says retry in 72s
	});
	assert.equal(calls, 1);

	// Before 72s → still backed off (forced) → no network.
	c.advance(60_000);
	await cache.get(async () => {
		calls++;
		return okSnapshot(70);
	}, { force: true });
	assert.equal(calls, 1, "still within Retry-After window");

	// After 72s → fetches again.
	c.advance(13_000);
	const after = await cache.get(async () => {
		calls++;
		return okSnapshot(70);
	});
	assert.equal(calls, 2);
	assert.equal(after.session.usedPercent, 70);
});

test("Retry-After is clamped to a 15s floor", async () => {
	const c = clock();
	const cache = new UsageCache({ provider: "claude", now: c.now });
	await cache.get(async () => okSnapshot(60));
	c.advance(DEFAULT_TTL_MS + 1);

	let calls = 0;
	await cache.get(async () => {
		calls++;
		throw rateLimited("429", 1_000); // absurdly short → must be floored to 15s
	});
	// At +10s (under the 15s floor) → still backed off.
	c.advance(10_000);
	await cache.get(async () => {
		calls++;
		return okSnapshot(70);
	}, { force: true });
	assert.equal(calls, 1, "floored backoff still active at 10s");
});
