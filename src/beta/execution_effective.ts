/**
 * Effektive Ausführungs-Wahrheit für Beta-UI.
 *
 * Hierarchie:
 * - Global Dryrun → alle Add-ons effektiv dryrun (auch wenn Add-on „live“ zeigt)
 * - Global Live → Add-on schreibt nur, wenn es selbst live ist
 *
 * Modes werden hier nicht mutiert — nur die kombinierte Wirkung dargestellt.
 */

import type { ExecutionMode } from "../execution_mode";
import { EXECUTION_MODE_ADDON_IDS, parseMode } from "../execution_mode";

export type EffectiveExecutionSnapshot = {
	schemaVersion: 1;
	globalMode: ExecutionMode;
	/** true wenn global live — notwendige, aber nicht hinreichende Voraussetzung. */
	globalLive: boolean;
	addons: Record<
		string,
		{
			configuredMode: ExecutionMode;
			/** Tatsächlich schreibberechtigt (global∧addon live). */
			effectiveWriteMode: ExecutionMode;
			liveWritesPossible: boolean;
			/** Kurze Begründung der effektiven Wirkung. */
			blockReasonDe: string | null;
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
	const blockedByGlobal: string[] = [];
	const blockedByAddon: string[] = [];
	for (const id of EXECUTION_MODE_ADDON_IDS) {
		const configuredMode = parseMode(input.addonModes[id]);
		const liveWritesPossible = globalLive && configuredMode === "live";
		let blockReasonDe: string | null = null;
		if (!globalLive) {
			blockReasonDe = "Global Dryrun";
			if (configuredMode === "live") blockedByGlobal.push(id);
		} else if (configuredMode !== "live") {
			blockReasonDe = "Add-on Dryrun";
			blockedByAddon.push(id);
		}
		addons[id] = {
			configuredMode,
			effectiveWriteMode: liveWritesPossible ? "live" : "dryrun",
			liveWritesPossible,
			blockReasonDe,
		};
	}
	let summaryDe: string;
	if (!globalLive) {
		summaryDe =
			"Ausführung: Global Dryrun — keine realen Gerätewrites (sperrt alle Add-ons).";
		if (blockedByGlobal.length) {
			summaryDe += ` Hinweis: ${blockedByGlobal.join(", ")} steht auf live, ist aber durch Global Dryrun wirkungslos.`;
		}
	} else {
		summaryDe =
			"Ausführung: Global Live — Writes nur für Add-ons, die selbst auf Live stehen und technisch freigegeben sind.";
		if (blockedByAddon.length) {
			summaryDe += ` Dryrun: ${blockedByAddon.join(", ")}.`;
		}
	}
	return { schemaVersion: 1, globalMode, globalLive, addons, summaryDe };
}
