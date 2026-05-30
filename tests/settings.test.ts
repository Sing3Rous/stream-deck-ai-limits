import test from "node:test";
import assert from "node:assert/strict";

import {
	resolveClaudeSettings,
	DEFAULT_INTERVAL_SEC,
	MIN_INTERVAL_SEC,
	MAX_INTERVAL_SEC,
	DEFAULT_WARNING_THRESHOLD,
	DEFAULT_CRITICAL_THRESHOLD,
} from "../src/settings/claude-settings.ts";

test("empty settings → all defaults", () => {
	const r = resolveClaudeSettings();
	assert.equal(r.intervalSec, DEFAULT_INTERVAL_SEC);
	assert.equal(r.thresholds.warning, DEFAULT_WARNING_THRESHOLD);
	assert.equal(r.thresholds.critical, DEFAULT_CRITICAL_THRESHOLD);
	assert.equal(r.customCredentialsPath, undefined);
});

test("interval is clamped to [MIN, MAX] and rounded", () => {
	assert.equal(resolveClaudeSettings({ refreshIntervalSec: 5 }).intervalSec, MIN_INTERVAL_SEC);
	assert.equal(resolveClaudeSettings({ refreshIntervalSec: 99999 }).intervalSec, MAX_INTERVAL_SEC);
	assert.equal(resolveClaudeSettings({ refreshIntervalSec: 62.7 }).intervalSec, 63);
	assert.equal(resolveClaudeSettings({ refreshIntervalSec: 30 }).intervalSec, 30);
});

test("invalid interval → default", () => {
	assert.equal(resolveClaudeSettings({ refreshIntervalSec: Number.NaN }).intervalSec, DEFAULT_INTERVAL_SEC);
	assert.equal(
		resolveClaudeSettings({ refreshIntervalSec: "abc" as unknown as number }).intervalSec,
		DEFAULT_INTERVAL_SEC,
	);
});

test("thresholds clamped to 0..100 and rounded", () => {
	const r = resolveClaudeSettings({ warningThreshold: -10, criticalThreshold: 250 });
	assert.equal(r.thresholds.warning, 0);
	assert.equal(r.thresholds.critical, 100);
});

test("critical is forced to be >= warning", () => {
	const r = resolveClaudeSettings({ warningThreshold: 80, criticalThreshold: 50 });
	assert.equal(r.thresholds.warning, 80);
	assert.equal(r.thresholds.critical, 80);
});

test("custom credentials path is trimmed; blank → undefined", () => {
	assert.equal(resolveClaudeSettings({ customCredentialsPath: "  /tmp/creds.json  " }).customCredentialsPath, "/tmp/creds.json");
	assert.equal(resolveClaudeSettings({ customCredentialsPath: "   " }).customCredentialsPath, undefined);
	assert.equal(resolveClaudeSettings({ customCredentialsPath: "" }).customCredentialsPath, undefined);
});

test("valid full settings pass through", () => {
	const r = resolveClaudeSettings({
		refreshIntervalSec: 45,
		warningThreshold: 60,
		criticalThreshold: 85,
		customCredentialsPath: "/home/u/.claude/.credentials.json",
	});
	assert.equal(r.intervalSec, 45);
	assert.equal(r.thresholds.warning, 60);
	assert.equal(r.thresholds.critical, 85);
	assert.equal(r.customCredentialsPath, "/home/u/.claude/.credentials.json");
});
