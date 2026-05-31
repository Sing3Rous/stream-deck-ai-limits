import test from "node:test";
import assert from "node:assert/strict";

import { normalizeClaudeUsage } from "../src/providers/claude/claude-normalizer.ts";
import type { ClaudeUsageResponse } from "../src/providers/claude/claude-types.ts";

const NOW = new Date("2026-05-30T12:00:00.000Z");

function normalize(raw: ClaudeUsageResponse) {
	return normalizeClaudeUsage(raw, undefined, NOW);
}

test("maps five_hour→session and seven_day→weekly", () => {
	const snap = normalize({
		five_hour: { utilization: 86, resets_at: "2026-05-30T15:00:00Z" },
		seven_day: { utilization: 51, resets_at: "2026-06-02T00:00:00Z" },
	});
	assert.equal(snap.provider, "claude");
	assert.equal(snap.session.usedPercent, 86);
	assert.equal(snap.session.resetAt, "2026-05-30T15:00:00Z");
	assert.equal(snap.weekly.usedPercent, 51);
	assert.equal(snap.weekly.resetAt, "2026-06-02T00:00:00Z");
	assert.equal(snap.stale, false);
	assert.equal(snap.updatedAt, NOW.toISOString());
});

test("rounds fractional utilization to an integer", () => {
	const snap = normalize({ five_hour: { utilization: 72.6 }, seven_day: { utilization: 44.2 } });
	assert.equal(snap.session.usedPercent, 73);
	assert.equal(snap.weekly.usedPercent, 44);
});

test("clamps out-of-range utilization to 0..100", () => {
	const snap = normalize({ five_hour: { utilization: 140 }, seven_day: { utilization: -5 } });
	assert.equal(snap.session.usedPercent, 100);
	assert.equal(snap.weekly.usedPercent, 0);
});

test("status reflects the worse of the two windows", () => {
	assert.equal(normalize({ five_hour: { utilization: 10 }, seven_day: { utilization: 95 } }).status, "critical");
	assert.equal(normalize({ five_hour: { utilization: 75 }, seven_day: { utilization: 20 } }).status, "warning");
	assert.equal(normalize({ five_hour: { utilization: 100 }, seven_day: { utilization: 0 } }).status, "limited");
	assert.equal(normalize({ five_hour: { utilization: 10 }, seven_day: { utilization: 20 } }).status, "ok");
});

test("missing windows become null and do not throw", () => {
	const snap = normalize({});
	assert.equal(snap.session.usedPercent, null);
	assert.equal(snap.session.resetAt, null);
	assert.equal(snap.weekly.usedPercent, null);
	assert.equal(snap.status, "ok"); // both unknown → ok (caller decides on error status)
});

test("partial response: one window present, one missing", () => {
	const snap = normalize({ five_hour: { utilization: 95, resets_at: "2026-05-30T15:00:00Z" } });
	assert.equal(snap.session.usedPercent, 95);
	assert.equal(snap.weekly.usedPercent, null);
	assert.equal(snap.status, "critical");
});

test("non-numeric / null utilization becomes null", () => {
	const snap = normalize({
		five_hour: { utilization: null, resets_at: "x" },
		seven_day: { utilization: Number.NaN as unknown as number },
	});
	assert.equal(snap.session.usedPercent, null);
	assert.equal(snap.weekly.usedPercent, null);
});

test("respects custom thresholds", () => {
	const snap = normalizeClaudeUsage(
		{ five_hour: { utilization: 55 }, seven_day: { utilization: 10 } },
		{ warning: 50, critical: 80 },
		NOW,
	);
	assert.equal(snap.status, "warning");
});
