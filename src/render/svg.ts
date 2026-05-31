/** Shared SVG helpers used by the usage renderers. */

/** Canvas size. 144x144 is the Stream Deck high-DPI key size; SVG scales to any device. */
export const SIZE = 144;

/** Encode an SVG string as a data URL accepted by `KeyAction.setImage`. */
export function toDataUrl(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
