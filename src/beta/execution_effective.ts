/**
 * Effektive Ausführungs-Wahrheit für Beta-UI.
 *
 * Hierarchie:
 * - Global Dryrun → keine Writes (Add-on live plant weiter)
 * - Global Live + Add-on off → keine Participation/Writes
 * - Global Live + Add-on dryrun → planen, keine Writes
 * - Global Live + Add-on live → Writes möglich
 *
 * Modes werden hier nicht mutiert — nur die kombinierte Wirkung dargestellt.
 */

import type { AddonExecutionMode, GlobalExecutionMode } from "../execution_mode";
import { EXECUTION_MODE_ADDON_IDS, parseAddonMode, parseGlobalMode } from "../execution_mode";

export type EffectiveExecutionSnapshot = {
	schemaVersion: 1;
	globalMode: GlobalExecutionMode;
	/** true wenn global live — notwendige, aber nicht hinreichende Voraussetzung. */
	globalLive: boolean;
	addons: Record<
		string,
		{
			configuredMode: AddonExecutionMode;
			/** Tatsächlich schreibberechtigt (global∧addon live). */
			effectiveWriteMode: "off" | "dryrun" | "live";
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
	const globalMode = parseGlobalMode(input.globalMode);
	const globalLive = globalMode === "live";
	const addons: EffectiveExecutionSnapshot["addons"] = {};
	const blockedByGlobal: string[] = [];
	const blockedByAddonDryrun: string[] = [];
	const blockedByAddonOff: string[] = [];
	for (const id of EXECUTION_MODE_ADDON_IDS) {
		const configuredMode = parseAddonMode(input.addonModes[id]);
		const liveWritesPossible = globalLive && configuredMode === "live";
		let blockReasonDe: string | null = null;
		let effectiveWriteMode: "off" | "dryrun" | "live" = "dryrun";
		if (configuredMode === "off") {
			effectiveWriteMode = "off";
			blockReasonDe = "Add-on Aus — EMS übernimmt nicht";
			blockedByAddonOff.push(id);
		} else if (!globalLive) {
			effectiveWriteMode = "dryrun";
			blockReasonDe = "Global Dryrun";
			if (configuredMode === "live") blockedByGlobal.push(id);
		} else if (configuredMode === "dryrun") {
			effectiveWriteMode = "dryrun";
			blockReasonDe = "Add-on Dryrun";
			blockedByAddonDryrun.push(id);
		} else {
			effectiveWriteMode = "live";
			blockReasonDe = null;
		}
		addons[id] = {
			configuredMode,
			effectiveWriteMode,
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
		if (blockedByAddonOff.length) {
			summaryDe += ` Aus: ${blockedByAddonOff.join(", ")}.`;
		}
		if (blockedByAddonDryrun.length) {
			summaryDe += ` Dryrun: ${blockedByAddonDryrun.join(", ")}.`;
		}
	}
	return { schemaVersion: 1, globalMode, globalLive, addons, summaryDe };
}
