import https from "node:https";

import { authRequired, genericError, rateLimited, UnauthorizedError } from "../../utils/errors.ts";
import { parseRetryAfterMs } from "../../utils/http.ts";
import type { RequestyOrgResponse, RequestyUsageResponse } from "./requesty-types.ts";

export { UnauthorizedError };

/** Requesty Management API host. */
const REQUESTY_API_HOST = "api-v2.requesty.ai";

/** Org info endpoint (GET with no body — safe for `fetch`). */
const ORG_PATH = "/v1/manage/org";

/**
 * Per-key usage endpoint. It is a GET **with a required JSON body** — Node's `fetch` (undici)
 * throws for GET requests with a body, so this call goes through core `https.request` via the
 * injectable {@link RequestyTransport}.
 */
const USAGE_PATH = "/v1/manage/apikey/self/usage";

/** Requests longer than this are aborted (8 s). */
const REQUEST_TIMEOUT_MS = 8_000;

/** The usage window: exactly 7 days (the documented max range is 100 days). */
const USAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Options handed to a {@link RequestyTransport}. */
export interface RequestyTransportOptions {
	hostname: string;
	path: string;
	method: string;
	headers: Record<string, string>;
	/** Raw JSON request body (the usage call always sends one). */
	body: string;
	timeoutMs: number;
}

/** Result of a {@link RequestyTransport} call. */
export interface RequestyTransportResult {
	statusCode: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

/**
 * Injectable transport seam for the usage call, defaulting to a core `https.request`
 * implementation. Tests inject a fake to avoid sockets and to assert the request shape.
 */
export type RequestyTransport = (options: RequestyTransportOptions) => Promise<RequestyTransportResult>;

/**
 * Fetch the raw Requesty org info (`GET /v1/manage/org`).
 *
 * @throws {UnauthorizedError} on HTTP 401 (caller may re-read credentials and retry once).
 * @throws {UsageError} `auth_required` on 403, `rate_limited` on 429, `error` otherwise.
 *
 * Never logs the API key or the Authorization header.
 */
export async function fetchRequestyOrg(apiKey: string): Promise<RequestyOrgResponse> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(`https://${REQUESTY_API_HOST}${ORG_PATH}`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
			signal: controller.signal,
		});
	} catch (err) {
		const aborted = (err as Error | null)?.name === "AbortError";
		throw genericError(aborted ? "Requesty org request timed out." : "Requesty org request network error.");
	} finally {
		clearTimeout(timer);
	}

	if (response.status === 401) {
		throw new UnauthorizedError();
	}
	if (response.status === 403) {
		throw authRequired("Requesty org request was forbidden. Check your API key.");
	}
	if (response.status === 429) {
		throw rateLimited("Requesty org rate limit reached.", parseRetryAfterMs(response.headers.get("retry-after")));
	}
	if (!response.ok) {
		throw genericError(`Requesty org request failed (HTTP ${response.status}).`);
	}

	try {
		return (await response.json()) as RequestyOrgResponse;
	} catch {
		throw genericError("Requesty org response was not valid JSON.");
	}
}

/**
 * Fetch the raw Requesty usage for the given key
 * (`GET /v1/manage/apikey/self/usage`), covering `now` minus 7 days through `now` at hour
 * resolution. Implemented with core `https.request` (not `fetch`) because undici rejects GET
 * requests with a body.
 *
 * @throws {UnauthorizedError} on HTTP 401 (caller may re-read credentials and retry once).
 * @throws {UsageError} `auth_required` on 403, `rate_limited` on 429, `error` otherwise.
 *
 * Never logs the API key or the Authorization header.
 */
export async function fetchRequestyUsage(
	apiKey: string,
	now: Date,
	transport: RequestyTransport = defaultRequestyTransport,
): Promise<RequestyUsageResponse> {
	const body = JSON.stringify({
		start: new Date(now.getTime() - USAGE_WINDOW_MS).toISOString(),
		end: now.toISOString(),
		resolution: "hour",
	});

	let result: RequestyTransportResult;
	try {
		result = await transport({
			hostname: REQUESTY_API_HOST,
			path: USAGE_PATH,
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body,
			timeoutMs: REQUEST_TIMEOUT_MS,
		});
	} catch (err) {
		const timedOut = (err as Error | null)?.name === "RequestyTimeoutError";
		throw genericError(timedOut ? "Requesty usage request timed out." : "Requesty usage request network error.");
	}

	if (result.statusCode === 401) {
		throw new UnauthorizedError();
	}
	if (result.statusCode === 403) {
		throw authRequired("Requesty usage request was forbidden. Check your API key.");
	}
	if (result.statusCode === 429) {
		throw rateLimited("Requesty usage rate limit reached.", parseRetryAfterMs(retryAfterOf(result.headers)));
	}
	if (result.statusCode < 200 || result.statusCode >= 300) {
		throw genericError(`Requesty usage request failed (HTTP ${result.statusCode}).`);
	}

	try {
		return JSON.parse(result.body) as RequestyUsageResponse;
	} catch {
		throw genericError("Requesty usage response was not valid JSON.");
	}
}

/** Default transport: a core `https.request` with an explicit 8 s socket-destroying timer. */
async function defaultRequestyTransport(options: RequestyTransportOptions): Promise<RequestyTransportResult> {
	return new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: options.hostname,
				path: options.path,
				method: options.method,
				headers: options.headers,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					resolve({
						statusCode: res.statusCode ?? 0,
						headers: res.headers as Record<string, string | string[] | undefined>,
						body: Buffer.concat(chunks).toString("utf-8"),
					});
				});
				res.on("error", reject);
			},
		);
		req.on("error", reject);
		const timer = setTimeout(() => req.destroy(new RequestyTimeoutError()), options.timeoutMs);
		req.on("close", () => clearTimeout(timer));
		if (options.body) {
			req.write(options.body);
		}
		req.end();
	});
}

/** Internal marker distinguishing a transport timeout from other network failures. */
class RequestyTimeoutError extends Error {
	constructor() {
		super("Requesty usage request timed out.");
		this.name = "RequestyTimeoutError";
	}
}

/** Normalize a `retry-after` header (Node may present it as a single string). */
function retryAfterOf(headers: Record<string, string | string[] | undefined>): string | null {
	const value = headers["retry-after"];
	if (Array.isArray(value)) {
		return value[0] ?? null;
	}
	return value ?? null;
}
