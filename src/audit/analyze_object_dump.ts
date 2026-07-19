/**
 * Read-only analysis of an exported ioBroker object tree vs the static catalog.
 * Never connects to a live instance; never copies state values or PII into reports.
 */
import { STATE_SURFACE_FAMILIES, type StateSurfaceFamily } from "./state_surface_catalog";

export type DumpObjectEntry = {
	_id?: string;
	type?: string;
	common?: { name?: unknown; type?: string };
	native?: unknown;
};

export type AnalyzeDumpOptions = {
	/** Adapter namespace prefix, e.g. ems.0 — stripped from absolute ids. */
	namespace?: string;
};

export type PrefixGroup = {
	prefix: string;
	objectCount: number;
	stateCount: number;
	channelCount: number;
	otherCount: number;
};

export type DumpAnalysis = {
	namespace: string | null;
	totalObjects: number;
	totalStates: number;
	totalChannels: number;
	totalOther: number;
	catalogEstimatedStatic: number;
	gapVsCatalog: number;
	matchedFamilies: Array<{
		id: string;
		targetClass: string;
		objectCount: number;
		stateCount: number;
		dynamicNote?: string;
	}>;
	unknownPrefixGroups: PrefixGroup[];
	explainedGapNotes: string[];
};

function stripNamespace(id: string, namespace: string | null): string {
	if (!namespace) return id;
	const prefix = `${namespace}.`;
	return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function detectNamespace(ids: string[]): string | null {
	const ems = ids.find((id) => /^ems\.\d+\./.test(id));
	if (!ems) return null;
	const m = /^(ems\.\d+)\./.exec(ems);
	return m ? m[1] : null;
}

function familyMatches(relativeId: string, family: StateSurfaceFamily): boolean {
	const patterns = family.idPattern.split("|").map((p) => p.trim());
	for (const pat of patterns) {
		if (pat.includes("<") || pat.includes("{")) {
			// Rough glob: replace <...> and {a,b} with wildcards for prefix match.
			const escaped = pat
				.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
				.replace(/\\<[^>]+\\>/g, "[^.]+")
				.replace(/\\\{[^}]+\\\}/g, "[^.]+")
				.replace(/\\\*/g, ".*");
			try {
				if (new RegExp(`^${escaped}`).test(relativeId) || relativeId.startsWith(pat.split(".")[0])) {
					// Prefer concrete prefix from pattern first token
				}
			} catch {
				/* ignore bad pattern */
			}
		}
		const concrete = pat.replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").replace(/\.\*$/, "");
		const head = concrete.split(".*")[0].replace(/\.$/, "");
		if (head && (relativeId === head || relativeId.startsWith(`${head}.`) || relativeId.startsWith(head))) {
			return true;
		}
	}
	// Explicit known prefixes by family id
	const PREFIX_BY_ID: Record<string, string[]> = {
		global: ["global.", "command.", "audit."],
		runtime_execution: ["addons."],
		global_modes_policy: ["global_modes.", "policy."],
		user_intent: ["user_intent."],
		planner_core: ["planner.intent."],
		planner_coordinator: ["planner.coordinator."],
		planner_authority: ["planner.authority."],
		planner_takeover: ["planner.takeover."],
		planner_authorization: ["planner.takeover.authorization."],
		forecast_plan: ["planner.intent.forecast_plan."],
		daily_plan: ["planner.intent.daily_plan."],
		allocations: ["planner.intent.allocation."],
		contributions: ["planner.intent.contributions."],
		grid_supply: ["planner.intent.supply.grid."],
		learning: ["learning."],
		backup_restore: ["backup.", "support.", "info.backup."],
		wallbox: ["addons.wallbox."],
		vehicle_profiles: ["addons.wallbox.vehicles."],
		battery: ["addons.battery.", "ems_mirror."],
		immersion_heater: ["addons.immersion_heater."],
		air_conditioning: ["addons.air_conditioning."],
		diagnostics_misc: ["addons.", "dryrun."],
	};
	const prefixes = PREFIX_BY_ID[family.id];
	if (prefixes) {
		return prefixes.some((p) => relativeId.includes(p) || relativeId.startsWith(p.replace(/^\./, "")));
	}
	return false;
}

function prefixKey(relativeId: string, depth = 3): string {
	const parts = relativeId.split(".");
	return parts.slice(0, Math.min(depth, parts.length)).join(".");
}

/**
 * Parse dump JSON: array of objects, or { objects: [...] }, or id→object map.
 * State values are ignored entirely.
 */
export function extractDumpObjects(raw: unknown): DumpObjectEntry[] {
	if (Array.isArray(raw)) {
		return raw.filter((x) => x && typeof x === "object") as DumpObjectEntry[];
	}
	if (raw && typeof raw === "object") {
		const rec = raw as Record<string, unknown>;
		if (Array.isArray(rec.objects)) {
			return rec.objects.filter((x) => x && typeof x === "object") as DumpObjectEntry[];
		}
		if (Array.isArray(rec.rows)) {
			return (rec.rows as Array<{ id?: string; value?: DumpObjectEntry; doc?: DumpObjectEntry }>)
				.map((r) => {
					const v = r.value ?? r.doc ?? {};
					return { ...v, _id: r.id ?? (v as DumpObjectEntry)._id };
				})
				.filter((x) => x._id);
		}
		// Map of id → object
		const out: DumpObjectEntry[] = [];
		for (const [id, val] of Object.entries(rec)) {
			if (!val || typeof val !== "object") continue;
			const o = val as DumpObjectEntry;
			if (o.type || o.common) {
				out.push({ ...o, _id: o._id ?? id });
			}
		}
		if (out.length) return out;
	}
	return [];
}

export function analyzeObjectDump(raw: unknown, options: AnalyzeDumpOptions = {}): DumpAnalysis {
	const objects = extractDumpObjects(raw);
	const ids = objects.map((o) => String(o._id ?? "")).filter(Boolean);
	const namespace = options.namespace ?? detectNamespace(ids);
	const relative = objects
		.map((o) => ({
			id: stripNamespace(String(o._id ?? ""), namespace),
			type: o.type ?? "unknown",
		}))
		.filter((o) => o.id && (!namespace || String(objects.find((x) => stripNamespace(String(x._id), namespace) === o.id)?._id ?? "").startsWith(namespace ?? "") || !namespace));

	// Prefer only objects under detected namespace when absolute ids present
	const scoped = namespace
		? objects
				.filter((o) => String(o._id ?? "").startsWith(`${namespace}.`))
				.map((o) => ({ id: stripNamespace(String(o._id), namespace), type: o.type ?? "unknown" }))
		: objects.map((o) => ({ id: String(o._id ?? ""), type: o.type ?? "unknown" }));

	let totalStates = 0;
	let totalChannels = 0;
	let totalOther = 0;
	for (const o of scoped) {
		if (o.type === "state") totalStates += 1;
		else if (o.type === "channel" || o.type === "folder" || o.type === "device") totalChannels += 1;
		else totalOther += 1;
	}

	const catalogEstimatedStatic = STATE_SURFACE_FAMILIES.reduce((s, f) => s + f.estimatedStaticCount, 0);

	const matchedFamilies = STATE_SURFACE_FAMILIES.map((f) => {
		let objectCount = 0;
		let stateCount = 0;
		for (const o of scoped) {
			if (!familyMatches(o.id, f)) continue;
			objectCount += 1;
			if (o.type === "state") stateCount += 1;
		}
		return {
			id: f.id,
			targetClass: f.targetClass,
			objectCount,
			stateCount,
			dynamicNote: f.dynamicNote,
		};
	}).filter((f) => f.objectCount > 0);

	const knownPrefixes = new Set<string>();
	for (const f of matchedFamilies) {
		knownPrefixes.add(f.id);
	}

	const unknown = scoped.filter((o) => !STATE_SURFACE_FAMILIES.some((f) => familyMatches(o.id, f)));
	const groupMap = new Map<string, PrefixGroup>();
	for (const o of unknown) {
		const key = prefixKey(o.id, 3);
		const g = groupMap.get(key) ?? {
			prefix: key,
			objectCount: 0,
			stateCount: 0,
			channelCount: 0,
			otherCount: 0,
		};
		g.objectCount += 1;
		if (o.type === "state") g.stateCount += 1;
		else if (o.type === "channel" || o.type === "folder") g.channelCount += 1;
		else g.otherCount += 1;
		groupMap.set(key, g);
	}
	const unknownPrefixGroups = [...groupMap.values()].sort((a, b) => b.objectCount - a.objectCount);

	const acFamily = matchedFamilies.find((f) => f.id === "air_conditioning" || f.id.includes("air"));
	const vehicleStates = scoped.filter((o) => o.id.startsWith("addons.wallbox.vehicles.") && o.type === "state").length;
	const acUnitFolders = new Set(
		scoped
			.map((o) => o.id)
			.filter((id) => /^addons\.air_conditioning\.units\.unit_\d+/.test(id))
			.map((id) => id.split(".").slice(0, 4).join(".")),
	);

	const explainedGapNotes = [
		`Catalog static estimate: ${catalogEstimatedStatic}; dump states: ${totalStates}; gap: ${totalStates - catalogEstimatedStatic}.`,
		`AC unit folder prefixes present: ${acUnitFolders.size} (placeholders for unconfigured units inflate dump).`,
		`Wallbox vehicle profile states: ${vehicleStates}.`,
		acFamily
			? `Air-conditioning matched objects: ${acFamily.objectCount} (states ${acFamily.stateCount}).`
			: "Air-conditioning family not matched by pattern heuristics.",
		"Unknown groups below are prefixes not classified by the static catalog (metadata only; no values).",
	];

	return {
		namespace,
		totalObjects: scoped.length,
		totalStates,
		totalChannels,
		totalOther,
		catalogEstimatedStatic,
		gapVsCatalog: totalStates - catalogEstimatedStatic,
		matchedFamilies,
		unknownPrefixGroups,
		explainedGapNotes,
	};
}

export function formatDumpAnalysisMarkdown(analysis: DumpAnalysis): string {
	const lines: string[] = [
		"# State Surface — Production Gap Analysis",
		"",
		"Read-only dump vs static catalog. No state values or PII included.",
		"",
		`| Metric | Value |`,
		`|--------|------:|`,
		`| Namespace | ${analysis.namespace ?? "(relative ids)"} |`,
		`| Objects (dump) | ${analysis.totalObjects} |`,
		`| States | ${analysis.totalStates} |`,
		`| Channels/folders/devices | ${analysis.totalChannels} |`,
		`| Other | ${analysis.totalOther} |`,
		`| Catalog static estimate | ${analysis.catalogEstimatedStatic} |`,
		`| Gap (states − catalog) | ${analysis.gapVsCatalog} |`,
		"",
		"## Gap notes",
		"",
		...analysis.explainedGapNotes.map((n) => `- ${n}`),
		"",
		"## Matched families (object/state counts from dump)",
		"",
		"| Family | Class | Objects | States |",
		"|--------|-------|--------:|-------:|",
	];
	for (const f of analysis.matchedFamilies.sort((a, b) => b.stateCount - a.stateCount)) {
		lines.push(`| ${f.id} | ${f.targetClass} | ${f.objectCount} | ${f.stateCount} |`);
	}
	lines.push("", "## Unknown prefix groups", "");
	if (!analysis.unknownPrefixGroups.length) {
		lines.push("_None_");
	} else {
		lines.push("| Prefix | Objects | States | Channels | Other |");
		lines.push("|--------|--------:|-------:|---------:|------:|");
		for (const g of analysis.unknownPrefixGroups.slice(0, 40)) {
			lines.push(
				`| ${g.prefix} | ${g.objectCount} | ${g.stateCount} | ${g.channelCount} | ${g.otherCount} |`,
			);
		}
	}
	lines.push("");
	return lines.join("\n");
}
