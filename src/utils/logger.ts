import streamDeck from "@elgato/streamdeck";

/**
 * Safe logging surface for the plugin.
 *
 * It is a thin wrapper over the Stream Deck logger that exists to make one rule explicit and
 * greppable: **never log token material or Authorization headers**. Only log statuses, HTTP
 * codes, file paths (not contents), and sanitized messages.
 *
 * Callers must pass already-sanitized strings; this wrapper does not redact for you.
 */
export interface SafeLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
	debug(message: string): void;
}

const base = streamDeck.logger;

export const logger: SafeLogger = {
	info: (m) => base.info(m),
	warn: (m) => base.warn(m),
	error: (m) => base.error(m),
	debug: (m) => base.debug(m),
};

/** A no-op logger for unit tests / non-SDK contexts. */
export const noopLogger: SafeLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
};
