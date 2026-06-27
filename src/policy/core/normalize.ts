import type { MutualExclusionRule, PolicyIssue, TriState } from "./types";

/** Stabile Key-Sortierung für Objekte (rekursiv). */
export function sortKeysDeep(value: unknown): unknown {
	if (value === null || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => sortKeysDeep(item));
	}
	const obj = value as Record<string, unknown>;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(obj).sort()) {
		const v = obj[key];
		if (v !== undefined) {
			sorted[key] = sortKeysDeep(v);
		}
	}
	return sorted;
}

export function normalizeTriState(raw: unknown): TriState {
	if (raw === true || raw === "true" || raw === 1 || raw === "yes") {
		return true;
	}
	if (raw === false || raw === "false" || raw === 0 || raw === "no") {
		return false;
	}
	return "unknown";
}

/** energyPriority: Reihenfolge = Priorität — Duplikate entfernen, erste Vorkommen behalten. */
export function normalizeEnergyPriority(list: unknown): string[] {
	if (!Array.isArray(list)) {
		return [];
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of list) {
		if (typeof item !== "string") {
			continue;
		}
		const s = item.trim();
		if (!s || seen.has(s)) {
			continue;
		}
		seen.add(s);
		out.push(s);
	}
	return out;
}

/** mutualExclusions: nach id stabil sortieren. */
export function normalizeMutualExclusions(rules: unknown): MutualExclusionRule[] {
	if (!Array.isArray(rules)) {
		return [];
	}
	const out: MutualExclusionRule[] = [];
	const seenIds = new Set<string>();
	for (const raw of rules) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const r = raw as Record<string, unknown>;
		const id = typeof r.id === "string" ? r.id.trim() : "";
		const addonA = typeof r.addonA === "string" ? r.addonA.trim() : "";
		const addonB = typeof r.addonB === "string" ? r.addonB.trim() : "";
		if (!id || !addonA || !addonB || seenIds.has(id)) {
			continue;
		}
		if (addonA === addonB) {
			continue;
		}
		seenIds.add(id);
		out.push({
			id,
			addonA,
			addonB,
			...(typeof r.reason === "string" && r.reason.trim() ? { reason: r.reason.trim() } : {}),
		});
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function sortIssuesDeterministic(issues: PolicyIssue[]): PolicyIssue[] {
	return [...issues].sort((a, b) => {
		const sev =
			({ error: 0, warning: 1, info: 2 } as const)[a.severity] -
			({ error: 0, warning: 1, info: 2 } as const)[b.severity];
		if (sev !== 0) {
			return sev;
		}
		const code = a.code.localeCompare(b.code);
		if (code !== 0) {
			return code;
		}
		const pathA = a.path ?? "";
		const pathB = b.path ?? "";
		const path = pathA.localeCompare(pathB);
		if (path !== 0) {
			return path;
		}
		return a.message.localeCompare(b.message);
	});
}
