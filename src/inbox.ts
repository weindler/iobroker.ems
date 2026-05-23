import type { CommandIntent } from "./types";

/** Admin/json state: value may be object or JSON string. */
export function parseInboxValue(val: unknown): CommandIntent | null {
	if (val === null || val === undefined) return null;

	let data: unknown;
	if (typeof val === "string") {
		const s = val.trim();
		if (!s) return null;
		try {
			data = JSON.parse(s);
		} catch {
			return null;
		}
	} else if (typeof val === "object") {
		data = val;
	} else {
		return null;
	}

	if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
	return data as CommandIntent;
}
