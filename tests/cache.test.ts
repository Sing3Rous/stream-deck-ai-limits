import test from "node:test";
import assert from "node:assert/strict";

import {
	UsageCache,
	DEFAULT_TTL_MS,
	DEFAULT_FORCE_MIN_INTERVAL_MS,
	MIN_RATE_LIMIT_BACKOFF_MS,
	getSharedCache,
} from "../src/cache/ttl-cache.ts";
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

test("Retry-After=0 is NOT trusted: applies the minimum backoff to avoid a 429 loop", async () => {
	const c = clock();
	const cache = new UsageCache({ provider: "claude", now: c.now });
	await cache.get(async () => okSnapshot(60));
	c.advance(DEFAULT_TTL_MS + 1);

	let calls = 0;
	const limited = await cache.get(async () => {
		calls++;
		throw rateLimited("429", 0); // server says "retry now" but is still throttling
	});
	assert.equal(limited.status, "stale"); // had a prior snapshot
	assert.equal(calls, 1);

	// Well within the minimum backoff → no network call, even forced.
	c.advance(MIN_RATE_LIMIT_BACKOFF_MS - 5_000);
	await cache.get(async () => {
		calls++;
		return okSnapshot(70);
	}, { force: true });
	assert.equal(calls, 1, "minimum backoff still active despite retry-after=0");

	// Past the minimum backoff → fetches again.
	c.advance(6_000);
	const after = await cache.get(async () => {
		calls++;
		return okSnapshot(70);
	});
	assert.equal(calls, 2);
	assert.equal(after.session.usedPercent, 70);
});

test("getSharedCache returns the same instance per provider+interval", () => {
	const a = getSharedCache("claude", 60_000);
	const b = getSharedCache("claude", 60_000);
	assert.equal(a, b, "same provider+interval → same cache instance");

	const codex = getSharedCache("codex", 60_000);
	assert.notEqual(a, codex, "different provider → different cache");

	const other = getSharedCache("claude", 30_000);
	assert.notEqual(a, other, "different interval → different cache");
});

test("shared cache retains last-good (the basis for surviving a tab switch)", async () => {
	// The shared instance is reused across key appearances, so its last good snapshot persists —
	// that's what lets a later 429 fall back to STALE instead of the big rate_limited screen.
	// (The stale-on-429 behavior itself is covered above with an injected clock.)
	const cache = getSharedCache("claude", 13579); // unique interval → isolated instance
	await cache.get(async () => okSnapshot(77));
	assert.equal(cache.lastSnapshot?.session.usedPercent, 77);

	// A second appearance grabs the SAME instance, which already holds the good snapshot.
	const again = getSharedCache("claude", 13579);
	assert.equal(again.lastSnapshot?.session.usedPercent, 77);
});

test("getSharedCache isolates requesty scopes by credentialScope and dollar thresholds", () => {
	const base = {
		credentialScope: "env",
		requestyThresholds: { balanceWarningUsd: 5, balanceCriticalUsd: 2, spendWarningUsd: 2, spendCriticalUsd: 5 },
	} as const;

	const a = getSharedCache("requesty", 60_000, base);
	const b = getSharedCache("requesty", 60_000, base);
	assert.equal(a, b, "identical scope → same cache instance");

	const envDiff = getSharedCache("requesty", 60_000, { ...base, credentialScope: "default" });
	assert.notEqual(a, envDiff, "different credentialScope → different cache");

	const threshDiff = getSharedCache("requesty", 60_000, {
		...base,
		requestyThresholds: { balanceWarningUsd: 10, balanceCriticalUsd: 5, spendWarningUsd: 4, spendCriticalUsd: 9 },
	});
	assert.notEqual(a, threshDiff, "different dollar thresholds → different cache");

	const unscoped = getSharedCache("requesty", 60_000);
	assert.notEqual(a, unscoped, "scoped vs unscoped → different cache");
});

test("getSharedCache isolates claude scopes by credentials path and percent thresholds", () => {
	const base = { customCredentialsPath: "/tmp/a.json", thresholds: { warning: 70, critical: 90 } } as const;

	const a = getSharedCache("claude", 60_000, base);
	const same = getSharedCache("claude", 60_000, base);
	assert.equal(a, same, "identical scope → same cache instance");

	assert.notEqual(
		a,
		getSharedCache("claude", 60_000, { ...base, customCredentialsPath: "/tmp/b.json" }),
		"different credentials path → different cache",
	);
	assert.notEqual(
		a,
		getSharedCache("claude", 60_000, { ...base, thresholds: { warning: 80, critical: 95 } }),
		"different percent thresholds → different cache",
	);
	assert.notEqual(a, getSharedCache("claude", 60_000), "scoped vs unscoped → different cache");
});

test("force throttle gates on last ATTEMPT, not last success (failed fetch then spam)", async () => {
	const c = clock();
	// Long backoff so the rate-limit path doesn't interfere; we test the force throttle itself.
	const cache = new UsageCache({ provider: "claude", now: c.now });

	let calls = 0;
	// First attempt fails (no good snapshot yet).
	await cache.get(async () => {
		calls++;
		throw genericError("boom");
	});
	assert.equal(calls, 1);

	// Rapid forced presses within the throttle window must NOT hit the network again, even
	// though there was no *successful* fetch to anchor on.
	c.advance(2_000);
	await cache.get(async () => {
		calls++;
		return okSnapshot(50);
	}, { force: true });
	c.advance(2_000);
	await cache.get(async () => {
		calls++;
		return okSnapshot(50);
	}, { force: true });

	assert.equal(calls, 1, "spamming after a failed fetch does not re-hit the endpoint");
});
