import test from "node:test";
import assert from "node:assert/strict";

import { statusForPercent, worstStatus } from "../src/providers/status.ts";
import type { UsageWindow } from "../src/providers/types.ts";

const w = (usedPercent: number | null): UsageWindow => ({ usedPercent, resetAt: null });

test("statusForPercent: bands with default thresholds (70 / 90)", () => {
	assert.equal(statusForPercent(0), "ok");
	assert.equal(statusForPercent(69), "ok");
	assert.equal(statusForPercent(70), "warning");
	assert.equal(statusForPercent(89), "warning");
	assert.equal(statusForPercent(90), "critical");
	assert.equal(statusForPercent(99), "critical");
	assert.equal(statusForPercent(100), "limited");
});

test("statusForPercent: custom thresholds", () => {
	assert.equal(statusForPercent(50, { warning: 50, critical: 80 }), "warning");
	assert.equal(statusForPercent(79, { warning: 50, critical: 80 }), "warning");
	assert.equal(statusForPercent(80, { warning: 50, critical: 80 }), "critical");
});

test("worstStatus: picks the more severe of the two windows", () => {
	assert.equal(worstStatus(w(10), w(95)), "critical");
	assert.equal(worstStatus(w(75), w(20)), "warning");
	assert.equal(worstStatus(w(100), w(0)), "limited");
	assert.equal(worstStatus(w(10), w(20)), "ok");
});

test("worstStatus: ignores null windows; both null → ok", () => {
	assert.equal(worstStatus(w(null), w(95)), "critical");
	assert.equal(worstStatus(w(null), w(null)), "ok");
});
