import type { PolicySnapshot, PolicySource, PolicyValue } from "./types";

function collectFromSection(
	section: Record<string, PolicyValue<unknown>>,
	out: Record<string, PolicySource>,
	prefix: string,
): void {
	for (const key of Object.keys(section).sort()) {
		const pv = section[key];
		if (!pv) {
			continue;
		}
		out[`${prefix}.${key}`] = pv.source;
	}
}

/** Flache Herkunftsübersicht für policy.*.provenance_json */
export function buildProvenanceMap(snapshot: PolicySnapshot): Record<string, PolicySource> {
	const out: Record<string, PolicySource> = {};
	collectFromSection(snapshot.capabilities as Record<string, PolicyValue<unknown>>, out, "capabilities");
	collectFromSection(snapshot.limits, out, "limits");
	collectFromSection(snapshot.preferences, out, "preferences");
	collectFromSection(snapshot.protection, out, "protection");
	collectFromSection(snapshot.economics, out, "economics");
	return out;
}
