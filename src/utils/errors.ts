import type { UsageStatus } from "../providers/types.ts";

/**
 * The subset of {@link UsageStatus} values that represent failures the provider can surface
 * to the UI. Used as the `status` of a {@link UsageError}.
 */
export type ErrorStatus = Extract<UsageStatus, "auth_required" | "rate_limited" | "error">;

/**
 * A provider-level error carrying a UI status and a secret-free message.
 *
 * Invariant: `message` must never contain a token, Authorization header, or file contents.
 * Construct these from sanitized, caller-controlled strings only.
 */
export class UsageError extends Error {
	readonly status: ErrorStatus;

	constructor(status: ErrorStatus, message: string) {
		super(message);
		this.name = "UsageError";
		this.status = status;
	}
}

export function authRequired(message: string): UsageError {
	return new UsageError("auth_required", message);
}

export function rateLimited(message: string): UsageError {
	return new UsageError("rate_limited", message);
}

export function genericError(message: string): UsageError {
	return new UsageError("error", message);
}

export function isUsageError(value: unknown): value is UsageError {
	return value instanceof UsageError;
}
