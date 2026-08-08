/**
 * Effektive Ausführungs-Wahrheit für Beta-UI.
 * Global dryrun → kein Add-on schreibt live (auch wenn Addon-State „live“ zeigt).
 */

import type { ExecutionMode } from "../execution_mode";
import { EXECUTION_MODE_ADDON_IDS, parseMode } from "../execution_mode";

export type EffectiveExecutionSnapshot = {
	schemaVersion: 1;
	globalMode: ExecutionMode;
	/** true wenn global live — Voraussetzung für Gerätewrites. */
	globalLive: boolean;
	addons: Record<
		string,
		{
			configuredMode: ExecutionMode;
			/** Tatsächlich schreibberechtigt (global∧addon live). */
			effectiveWriteMode: ExecutionMode;
			liveWritesPossible: boolean;
		}
	>;
	summaryDe: string;
};

export function buildEffectiveExecutionSnapshot(input: {
	globalMode: unknown;
	addonModes: Partial<Record<(typeof EXECUTION_MODE_ADDON_IDS)[number], unknown>>;
}): EffectiveExecutionSnapshot {
	const globalMode = parseMode(input.globalMode);
	const globalLive = globalMode === "live";
	const addons: EffectiveExecutionSnapshot["addons"] = {};
	const conflicts: string[] = [];
	for (const id of EXECUTION_MODE_ADDON_IDS) {
		const configuredMode = parseMode(input.addonModes[id]);
		const liveWritesPossible = globalLive && configuredMode === "live";
		addons[id] = {
			configuredMode,
			effectiveWriteMode: liveWritesPossible ? "live" : "dryrun",
			liveWritesPossible,
		};
		if (!globalLive && configuredMode === "live") {
			conflicts.push(id);
		}
	}
	let summaryDe =
		globalMode === "dryrun"
			? "Ausführung: Dryrun — keine realen Gerätewrites (auch wenn einzelne Add-ons auf live stehen)."
			: "Ausführung: Live — Writes nur für Add-ons, die ebenfalls live sind und technisch freigegeben.";
	if (conflicts.length) {
		summaryDe += ` Hinweis: ${conflicts.join(", ")} als live konfiguriert, aber durch Global-Dryrun wirkungslos.`;
	}
	return { schemaVersion: 1, globalMode, globalLive, addons, summaryDe };
}
