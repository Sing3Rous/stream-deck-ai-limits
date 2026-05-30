import test from "node:test";
import assert from "node:assert/strict";

import {
	resolveUsageSettings,
	DEFAULT_INTERVAL_SEC,
	MIN_INTERVAL_SEC,
	MAX_INTERVAL_SEC,
	DEFAULT_WARNING_THRESHOLD,
	DEFAULT_CRITICAL_THRESHOLD,
} from "../src/settings/usage-settings.ts";

test("empty settings → all defaults", () => {
	const r = resolveUsageSettings();
	assert.equal(r.intervalSec, DEFAULT_INTERVAL_SEC);
	assert.equal(r.thresholds.warning, DEFAULT_WARNING_THRESHOLD);
	assert.equal(r.thresholds.critical, DEFAULT_CRITICAL_THRESHOLD);
	assert.equal(r.customCredentialsPath, undefined);
});

test("interval is clamped to [MIN, MAX] and rounded", () => {
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 5 }).intervalSec, MIN_INTERVAL_SEC);
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 99999 }).intervalSec, MAX_INTERVAL_SEC);
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 62.7 }).intervalSec, 63);
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 30 }).intervalSec, 30);
});

test("invalid interval → default", () => {
	assert.equal(resolveUsageSettings({ refreshIntervalSec: Number.NaN }).intervalSec, DEFAULT_INTERVAL_SEC);
	assert.equal(
		resolveUsageSettings({ refreshIntervalSec: "abc" as unknown as number }).intervalSec,
		DEFAULT_INTERVAL_SEC,
	);
});

test("thresholds clamped to 0..100 and rounded", () => {
	const r = resolveUsageSettings({ warningThreshold: -10, criticalThreshold: 250 });
	assert.equal(r.thresholds.warning, 0);
	assert.equal(r.thresholds.critical, 100);
});

test("critical is forced to be >= warning", () => {
	const r = resolveUsageSettings({ warningThreshold: 80, criticalThreshold: 50 });
	assert.equal(r.thresholds.warning, 80);
	assert.equal(r.thresholds.critical, 80);
});

test("custom credentials path is trimmed; blank → undefined", () => {
	assert.equal(resolveUsageSettings({ customCredentialsPath: "  /tmp/creds.json  " }).customCredentialsPath, "/tmp/creds.json");
	assert.equal(resolveUsageSettings({ customCredentialsPath: "   " }).customCredentialsPath, undefined);
	assert.equal(resolveUsageSettings({ customCredentialsPath: "" }).customCredentialsPath, undefined);
});

test("valid full settings pass through", () => {
	const r = resolveUsageSettings({
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
