/**
 * Parse a `Retry-After` header into milliseconds. Supports the delta-seconds form (e.g. "72").
 * Returns `undefined` when absent or unparseable. (The HTTP-date form is not used by these
 * endpoints, so it is intentionally unsupported.)
 */
export function parseRetryAfterMs(headerValue: string | null): number | undefined {
	if (!headerValue) {
		return undefined;
	}
	const seconds = Number(headerValue.trim());
	if (Number.isFinite(seconds) && seconds >= 0) {
		return seconds * 1000;
	}
	return undefined;
}
