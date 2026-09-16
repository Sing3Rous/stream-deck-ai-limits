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

test("fable window comes from the weekly_scoped Fable entry in `limits`", () => {
	const snap = normalize({
		five_hour: { utilization: 1 },
		seven_day: { utilization: 0 },
		limits: [
			{ kind: "session", group: "session", percent: 1, resets_at: "2026-09-03T16:40:00Z" },
			{ kind: "weekly_all", group: "weekly", percent: 0, resets_at: "2026-09-10T03:00:00Z" },
			{
				kind: "weekly_scoped",
				group: "weekly",
				percent: 42.6,
				resets_at: "2026-09-10T03:00:00Z",
				scope: { model: { id: null, display_name: "Fable" }, surface: null },
			},
		],
	});
	assert.equal(snap.fable?.usedPercent, 43);
	assert.equal(snap.fable?.resetAt, "2026-09-10T03:00:00Z");
});

test("fable window is empty when `limits` is missing or has no Fable entry", () => {
	const none = normalize({ five_hour: { utilization: 1 }, seven_day: { utilization: 0 } });
	assert.deepEqual(none.fable, { usedPercent: null, resetAt: null });

	const other = normalize({
		five_hour: { utilization: 1 },
		seven_day: { utilization: 0 },
		limits: [{ kind: "weekly_scoped", percent: 90, scope: { model: { display_name: "Opus" } } }],
	});
	assert.deepEqual(other.fable, { usedPercent: null, resetAt: null });
});

test("fable window is found for a versioned model name", () => {
	// The endpoint is unofficial: a later response naming the model "Fable 5.1", or carrying only
	// a versioned id, must keep working without a plugin release.
	for (const model of [
		{ display_name: "Fable 5.1" },
		{ display_name: "FABLE 6" },
		{ id: "claude-fable-5-1", display_name: null },
		{ id: "claude-fable-6" },
	]) {
		const snap = normalize({
			five_hour: { utilization: 1 },
			seven_day: { utilization: 0 },
			limits: [{ kind: "weekly_scoped", percent: 42, scope: { model } }],
		});
		assert.equal(snap.fable?.usedPercent, 42, `should match ${JSON.stringify(model)}`);
	}
});

test("fable matching does not catch other models or lookalike names", () => {
	for (const model of [
		{ display_name: "Opus" },
		{ display_name: "Sonnet 4.5" },
		// A prefix match must not swallow an unrelated name that merely starts with the letters.
		{ display_name: "Fabletown" },
		{ id: "claude-opus-5", display_name: null },
	]) {
		const snap = normalize({
			five_hour: { utilization: 1 },
			seven_day: { utilization: 0 },
			limits: [{ kind: "weekly_scoped", percent: 90, scope: { model } }],
		});
		assert.deepEqual(snap.fable, { usedPercent: null, resetAt: null }, `should not match ${JSON.stringify(model)}`);
	}
});

test("fable window does not affect the overall status", () => {
	const snap = normalize({
		five_hour: { utilization: 10 },
		seven_day: { utilization: 20 },
		limits: [{ kind: "weekly_scoped", percent: 100, scope: { model: { display_name: "Fable" } } }],
	});
	assert.equal(snap.status, "ok");
});
