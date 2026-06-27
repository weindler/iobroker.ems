/** Leere/null-artige Werte (z. B. EVCC effectivePlanTime = "null"). */

const NULLISH_STRINGS = new Set(["null", "undefined", "none", "nil"]);

export function isEmptySentinel(raw: unknown): boolean {
	if (raw === null || raw === undefined) {
		return true;
	}
	if (typeof raw === "string") {
		const s = raw.trim().toLowerCase();
		return s === "" || NULLISH_STRINGS.has(s);
	}
	return false;
}
