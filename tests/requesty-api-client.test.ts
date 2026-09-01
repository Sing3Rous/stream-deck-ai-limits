import test from "node:test";
import assert from "node:assert/strict";

import {
	fetchRequestyOrg,
	fetchRequestyUsage,
	UnauthorizedError,
	type RequestyTransport,
	type RequestyTransportOptions,
	type RequestyTransportResult,
} from "../src/providers/requesty/requesty-api-client.ts";
import { isUsageError } from "../src/utils/errors.ts";

const NOW = new Date("2026-08-31T15:30:00Z");

// --- helpers ---------------------------------------------------------------

async function withFetch(
	impl: () => Promise<Response> | Response,
	run: (calls: Array<{ url: string; init: RequestInit }>) => Promise<void>,
): Promise<void> {
	const original = globalThis.fetch;
	const calls: Array<{ url: string; init: RequestInit }> = [];
	globalThis.fetch = (async (url, init) => {
		calls.push({ url: String(url), init: init ?? {} });
		return impl();
	}) as typeof fetch;
	try {
		await run(calls);
	} finally {
		globalThis.fetch = original;
	}
}

function response(status: number, body: unknown, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), { status, headers });
}

async function withTransport(
	impl: (options: RequestyTransportOptions) => Promise<RequestyTransportResult>,
	run: (transport: RequestyTransport, captured: RequestyTransportOptions[]) => Promise<void>,
): Promise<void> {
	const captured: RequestyTransportOptions[] = [];
	const transport: RequestyTransport = async (options) => {
		captured.push(options);
		return impl(options);
	};
	await run(transport, captured);
}

function transportResult(
	statusCode: number,
	body: unknown,
	headers?: Record<string, string | string[] | undefined>,
): RequestyTransportResult {
	return { statusCode, headers: headers ?? {}, body: JSON.stringify(body) };
}

// --- org call (fetch) ------------------------------------------------------

test("Requesty org call hits the endpoint with the bearer token", async () => {
	await withFetch(() => response(200, { name: "Test Org", balance: 12.34 }), async (calls) => {
		const org = await fetchRequestyOrg("FAKE_KEY");
		assert.equal(calls[0].url, "https://api-v2.requesty.ai/v1/manage/org");
		assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer FAKE_KEY", Accept: "application/json" });
		assert.equal(org.name, "Test Org");
		assert.equal(org.balance, 12.34);
	});
});

test("Requesty org call maps 401, 403, and 429 with Retry-After", async () => {
	await withFetch(() => response(401, {}), async () => assert.rejects(() => fetchRequestyOrg("FAKE"), UnauthorizedError));
	await withFetch(() => response(403, {}), async () =>
		assert.rejects(() => fetchRequestyOrg("FAKE"), (err: unknown) => isUsageError(err) && err.status === "auth_required"),
	);
	await withFetch(() => response(429, {}, { "Retry-After": "72" }), async () =>
		assert.rejects(
			() => fetchRequestyOrg("FAKE"),
			(err: unknown) => isUsageError(err) && err.status === "rate_limited" && err.retryAfterMs === 72_000,
		),
	);
});

test("Requesty org call maps network, timeout, non-OK, and invalid JSON failures without leaking keys", async () => {
	await withFetch(() => {
		throw new TypeError("network");
	}, async () => assert.rejects(() => fetchRequestyOrg("SECRET_CANARY"), (err: unknown) => isUsageError(err) && err.status === "error" && !err.message.includes("SECRET_CANARY")));
	await withFetch(() => {
		const err = new Error("abort");
		err.name = "AbortError";
		throw err;
	}, async () => assert.rejects(() => fetchRequestyOrg("FAKE"), (err: unknown) => isUsageError(err) && /timed out/i.test(err.message)));
	await withFetch(() => response(500, {}), async () =>
		assert.rejects(() => fetchRequestyOrg("FAKE"), (err: unknown) => isUsageError(err) && err.status === "error" && /HTTP 500/.test(err.message)),
	);
	await withFetch(() => new Response("not json", { status: 200 }), async () =>
		assert.rejects(() => fetchRequestyOrg("FAKE"), (err: unknown) => isUsageError(err) && err.status === "error"),
	);
});

// --- usage call (https transport) -----------------------------------------

test("Requesty usage call sends the right host, path, headers, and body", async () => {
	await withTransport(async () => transportResult(200, { usage: {} }), async (transport, captured) => {
		await fetchRequestyUsage("FAKE_KEY", NOW, transport);
		assert.equal(captured.length, 1);
		assert.equal(captured[0].hostname, "api-v2.requesty.ai");
		assert.equal(captured[0].path, "/v1/manage/apikey/self/usage");
		assert.equal(captured[0].method, "GET");
		assert.deepEqual(captured[0].headers, {
			Authorization: "Bearer FAKE_KEY",
			"Content-Type": "application/json",
			Accept: "application/json",
		});
		assert.equal(captured[0].timeoutMs, 8_000);
		const body = JSON.parse(captured[0].body);
		assert.equal(body.resolution, "hour");
		// start is exactly 7 days before the injected now; end is now.
		assert.equal(body.start, new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
		assert.equal(body.end, NOW.toISOString());
	});
});

test("Requesty usage call parses a 200 JSON body", async () => {
	await withTransport(async () => transportResult(200, { usage: { "2026-08-31T14:00:00Z": { spend: 1.5 } } }), async (transport) => {
		const usage = await fetchRequestyUsage("FAKE_KEY", NOW, transport);
		assert.equal(usage.usage?.["2026-08-31T14:00:00Z"]?.spend, 1.5);
	});
});

test("Requesty usage call maps 401, 403, and 429 with Retry-After", async () => {
	await withTransport(async () => transportResult(401, {}), async (transport) =>
		assert.rejects(() => fetchRequestyUsage("FAKE", NOW, transport), UnauthorizedError),
	);
	await withTransport(async () => transportResult(403, {}), async (transport) =>
		assert.rejects(() => fetchRequestyUsage("FAKE", NOW, transport), (err: unknown) => isUsageError(err) && err.status === "auth_required"),
	);
	await withTransport(async () => transportResult(429, {}, { "retry-after": "72" }), async (transport) =>
		assert.rejects(
			() => fetchRequestyUsage("FAKE", NOW, transport),
			(err: unknown) => isUsageError(err) && err.status === "rate_limited" && err.retryAfterMs === 72_000,
		),
	);
	// Node may present the header as an array.
	await withTransport(async () => transportResult(429, {}, { "retry-after": ["30"] }), async (transport) =>
		assert.rejects(
			() => fetchRequestyUsage("FAKE", NOW, transport),
			(err: unknown) => isUsageError(err) && err.status === "rate_limited" && err.retryAfterMs === 30_000,
		),
	);
});

test("Requesty usage call maps network, timeout, non-OK, and invalid JSON failures without leaking keys", async () => {
	await withTransport(async () => {
		throw new Error("network");
	}, async (transport) => assert.rejects(() => fetchRequestyUsage("SECRET_CANARY", NOW, transport), (err: unknown) => isUsageError(err) && err.status === "error" && !err.message.includes("SECRET_CANARY")));
	await withTransport(async () => {
		const err = new Error("timeout");
		err.name = "RequestyTimeoutError";
		throw err;
	}, async (transport) => assert.rejects(() => fetchRequestyUsage("FAKE", NOW, transport), (err: unknown) => isUsageError(err) && /timed out/i.test(err.message)));
	await withTransport(async () => transportResult(500, {}), async (transport) =>
		assert.rejects(() => fetchRequestyUsage("FAKE", NOW, transport), (err: unknown) => isUsageError(err) && err.status === "error" && /HTTP 500/.test(err.message)),
	);
	await withTransport(async () => ({ statusCode: 200, headers: {}, body: "not json" }), async (transport) =>
		assert.rejects(() => fetchRequestyUsage("FAKE", NOW, transport), (err: unknown) => isUsageError(err) && err.status === "error"),
	);
});
