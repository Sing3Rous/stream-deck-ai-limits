import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_REQUESTY_THRESHOLDS, type RequestyThresholds } from "../src/providers/types.ts";
import type { RequestyUsageEntry, RequestyUsageResponse } from "../src/providers/requesty/requesty-types.ts";
import {
	normalizeRequestyUsage,
	requestyMetricStatus,
} from "../src/providers/requesty/requesty-normalizer.ts";

// --- helpers ---------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date("2026-08-31T15:30:00Z");

/** Top-of-hour period start `hoursAgo` hours before now (used by the fixture). */
function periodKey(hoursAgo: number): string {
	const topOfHour = new Date(NOW.getTime());
	topOfHour.setUTCMinutes(0, 0, 0);
	return new Date(topOfHour.getTime() - hoursAgo * HOUR_MS).toISOString();
}

/** Hourly usage across the full 7-day window; spend is a function of hours-ago. */
function hourlyUsage(spendFor: (hoursAgo: number) => number): RequestyUsageResponse {
	const usage: Record<string, RequestyUsageEntry> = {};
	for (let h = 0; h < 7 * 24; h++) {
		usage[periodKey(h)] = { spend: spendFor(h) };
	}
	return { usage };
}

// --- requestyMetricStatus --------------------------------------------------

test("balance status boundaries (default thresholds: critical ≤ 2, warning ≤ 5)", () => {
	assert.equal(requestyMetricStatus(2.0, "balance"), "critical");
	assert.equal(requestyMetricStatus(2.01, "balance"), "warning");
	assert.equal(requestyMetricStatus(5.0, "balance"), "warning");
	assert.equal(requestyMetricStatus(5.01, "balance"), "ok");
	assert.equal(requestyMetricStatus(50, "balance"), "ok");
});

test("spend status boundaries (default thresholds: critical ≥ 5, warning ≥ 2)", () => {
	assert.equal(requestyMetricStatus(5.0, "spend"), "critical");
	assert.equal(requestyMetricStatus(4.99, "spend"), "warning");
	assert.equal(requestyMetricStatus(2.0, "spend"), "warning");
	assert.equal(requestyMetricStatus(1.99, "spend"), "ok");
	assert.equal(requestyMetricStatus(0.1, "spend"), "ok");
});

test("requestyMetricStatus honors custom thresholds", () => {
	const t: RequestyThresholds = { balanceWarningUsd: 10, balanceCriticalUsd: 3, spendWarningUsd: 1, spendCriticalUsd: 2 };
	assert.equal(requestyMetricStatus(9, "balance", t), "warning");
	assert.equal(requestyMetricStatus(3, "balance", t), "critical");
	assert.equal(requestyMetricStatus(1, "spend", t), "warning");
	assert.equal(requestyMetricStatus(2, "spend", t), "critical");
});

// --- normalizeRequestyUsage -------------------------------------------------

test("balance and spend sums from a realistic hourly fixture", () => {
	const snap = normalizeRequestyUsage(
		{ name: "Test Org", balance: 12.34 },
		hourlyUsage((h) => (h < 24 ? 1.0 : 0.25)),
		DEFAULT_REQUESTY_THRESHOLDS,
		NOW,
	);
	// Exactly the last 24 hourly periods land in the 24 h window.
	assert.equal(snap.requesty?.balanceUsd, 12.34);
	assert.equal(snap.requesty?.spend24hUsd, 24.0);
	// 24 × 1.0 + 144 × 0.25 = 60.0.
	assert.equal(snap.requesty?.spend7dUsd, 60.0);
	assert.equal(snap.provider, "requesty");
	assert.equal(snap.session.usedPercent, null);
	assert.equal(snap.session.resetAt, null);
	assert.equal(snap.weekly.usedPercent, null);
	assert.equal(snap.weekly.resetAt, null);
	assert.equal(snap.updatedAt, "2026-08-31T15:30:00.000Z");
	assert.equal(snap.stale, false);
});

test("status is the worst of the per-metric statuses", () => {
	// Balance 12.34 → ok; 24 h spend 24 → critical; 7 d spend 60 → critical.
	const critical = normalizeRequestyUsage(
		{ balance: 12.34 },
		hourlyUsage((h) => (h < 24 ? 1.0 : 0.25)),
		DEFAULT_REQUESTY_THRESHOLDS,
		NOW,
	);
	assert.equal(critical.status, "critical");

	// Balance 12.34 → ok; spends 0.024 / 0.168 → ok.
	const ok = normalizeRequestyUsage({ balance: 12.34 }, hourlyUsage(() => 0.001), DEFAULT_REQUESTY_THRESHOLDS, NOW);
	assert.equal(ok.status, "ok");

	// Balance 3 (warning); spends tiny → warning overall.
	const warning = normalizeRequestyUsage({ balance: 3 }, hourlyUsage(() => 0.001), DEFAULT_REQUESTY_THRESHOLDS, NOW);
	assert.equal(warning.status, "warning");

	// Balance 3 (warning); 24 h spend 6 (critical) → critical overall.
	const worstWins = normalizeRequestyUsage(
		{ balance: 3 },
		hourlyUsage((h) => (h < 24 ? 0.25 : 0.001)),
		DEFAULT_REQUESTY_THRESHOLDS,
		NOW,
	);
	assert.equal(worstWins.status, "critical");
});

test("missing usage map → null spends, status from balance only", () => {
	const snap = normalizeRequestyUsage({ balance: 1.5 }, {}, DEFAULT_REQUESTY_THRESHOLDS, NOW);
	assert.equal(snap.requesty?.balanceUsd, 1.5);
	assert.equal(snap.requesty?.spend24hUsd, null);
	assert.equal(snap.requesty?.spend7dUsd, null);
	assert.equal(snap.status, "critical"); // balance 1.5 ≤ 2
});

test("missing org balance → null balance, status from spends only", () => {
	const snap = normalizeRequestyUsage({}, hourlyUsage(() => 6.0), DEFAULT_REQUESTY_THRESHOLDS, NOW);
	assert.equal(snap.requesty?.balanceUsd, null);
	assert.equal(snap.status, "critical"); // 7 d spend 6 ≥ 5
});

test("everything missing → all metrics null, status ok", () => {
	const snap = normalizeRequestyUsage({}, {}, DEFAULT_REQUESTY_THRESHOLDS, NOW);
	assert.equal(snap.requesty?.balanceUsd, null);
	assert.equal(snap.requesty?.spend24hUsd, null);
	assert.equal(snap.requesty?.spend7dUsd, null);
	assert.equal(snap.status, "ok");
});

test("non-finite balance → null balance", () => {
	const snap = normalizeRequestyUsage({ balance: Number.NaN }, hourlyUsage(() => 0.1), DEFAULT_REQUESTY_THRESHOLDS, NOW);
	assert.equal(snap.requesty?.balanceUsd, null);
});

test("unparseable periods count toward the 7 d sum but not the 24 h sum", () => {
	const usage: RequestyUsageResponse = {
		usage: {
			"not-a-date": { spend: 5 },
			[periodKey(1)]: { spend: 1 },
		},
	};
	const snap = normalizeRequestyUsage({ balance: 50 }, usage, DEFAULT_REQUESTY_THRESHOLDS, NOW);
	assert.equal(snap.requesty?.spend24hUsd, 1);
	assert.equal(snap.requesty?.spend7dUsd, 6);
});

test("money is rounded to 2 decimals", () => {
	const usage: RequestyUsageResponse = {
		usage: {
			[periodKey(1)]: { spend: 0.333 },
			[periodKey(2)]: { spend: 0.333 },
			[periodKey(3)]: { spend: 0.333 },
		},
	};
	const snap = normalizeRequestyUsage({ balance: 0.005 }, usage, DEFAULT_REQUESTY_THRESHOLDS, NOW);
	assert.equal(snap.requesty?.spend24hUsd, 1.0); // 0.999 → 1.0
	assert.equal(snap.requesty?.spend7dUsd, 1.0);
	assert.equal(snap.requesty?.balanceUsd, 0.01); // 0.005 → 0.01
});

test("non-finite spends are ignored", () => {
	const usage: RequestyUsageResponse = {
		usage: {
			[periodKey(1)]: { spend: 2 },
			[periodKey(2)]: { spend: Number.NaN },
			[periodKey(3)]: { spend: Number.POSITIVE_INFINITY },
		},
	};
	const snap = normalizeRequestyUsage({ balance: 50 }, usage, DEFAULT_REQUESTY_THRESHOLDS, NOW);
	assert.equal(snap.requesty?.spend24hUsd, 2);
	assert.equal(snap.requesty?.spend7dUsd, 2);
});

test("the requesty block carries the thresholds used", () => {
	const thresholds: RequestyThresholds = { balanceWarningUsd: 50, balanceCriticalUsd: 10, spendWarningUsd: 1, spendCriticalUsd: 3 };
	const snap = normalizeRequestyUsage({ balance: 20 }, hourlyUsage(() => 0.001), thresholds, NOW);
	assert.deepEqual(snap.requesty?.thresholds, thresholds);
	assert.equal(snap.status, "warning"); // balance 20 ≤ 50; spends below spendWarningUsd
});
