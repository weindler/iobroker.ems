import { legacyWallboxMappingFromConfig, WALLBOX_FLAT_PREFIX } from "../../../mapping_config";
import {
	evccControlTargetForRole,
	resolveWallboxControlModel,
} from "../evcc_control_config";
import { resolveEvccModeControlContract } from "../evcc_mode_control";
import type { WallboxDispatchIntent, WallboxChargeSource } from "./intent";
import type { WallboxPlanDecision, WallboxTelemetryInput } from "./daily_plan";

/** EVCC/go-e typischerweise ganzzahlige Ampere — dokumentiert in EMS_LIGHT_WALLBOX_DRYRUN_DISPATCH.md */
export const WALLBOX_CURRENT_STEP_A = 1;
export const WALLBOX_AC_VOLTAGE_V = 230;

export type WallboxDispatchStatus =
	| "idle"
	| "none"
	| "hold"
	| "charge_planned"
	| "degraded"
	| "blocked";

export type WallboxDeadlineStatus = "ok" | "at_risk" | "unknown";

export interface WallboxDispatchTarget {
	action: WallboxDispatchIntent["action"];
	enableCharging: boolean;
	targetPowerW: number | null;
	targetCurrentA: number | null;
	phases: number | null;
	desiredEvccMode: string | null;
	source: WallboxChargeSource;
	valid: boolean;
	reasonDe: string;
}

export interface WallboxDispatchReadiness {
	controlMappingComplete: boolean;
	enableMappingAvailable: boolean;
	currentMappingAvailable: boolean;
	powerMappingAvailable: boolean;
	modeMappingAvailable: boolean;
	liveDispatchSupported: false;
	missingMappings: string[];
	reasonDe: string;
}

export interface DryrunCommandEntry {
	role: string;
	desiredValue: string | number | boolean | null;
	currentValue: string | number | boolean | null;
	writeRequired: boolean;
}

export interface WallboxDryrunDispatchResult {
	dispatchStatus: WallboxDispatchStatus;
	dispatchReasonDe: string;
	intent: WallboxDispatchIntent;
	target: WallboxDispatchTarget;
	readiness: WallboxDispatchReadiness;
	deadlineStatus: WallboxDeadlineStatus;
	dryrunCommand: DryrunCommandEntry[];
}

interface DispatchCacheKey {
	revision: number | null;
	connected: boolean;
	action: string;
	targetPowerW: number | null;
	phases: number | null;
	governance: boolean;
}

let lastCacheKey: DispatchCacheKey | null = null;
let lastResult: WallboxDryrunDispatchResult | null = null;

export function resetWallboxDispatchCache(): void {
	lastCacheKey = null;
	lastResult = null;
}

function mappingTarget(config: Record<string, unknown>, prefix: string): string {
	const t = config[`${prefix}_target`];
	return typeof t === "string" ? t.trim() : "";
}

function mappingEnabled(config: Record<string, unknown>, prefix: string): boolean {
	const en = config[`${prefix}_enabled`];
	return en !== false;
}

export function evaluateWallboxDispatchReadiness(config: unknown): WallboxDispatchReadiness {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const controlModel = resolveWallboxControlModel(c);

	if (controlModel === "none") {
		return {
			controlMappingComplete: false,
			enableMappingAvailable: false,
			currentMappingAvailable: false,
			powerMappingAvailable: false,
			modeMappingAvailable: false,
			liveDispatchSupported: false,
			missingMappings: ["control_model_not_selected"],
			reasonDe: "Steuerpfad nicht ausgewählt — wb_control_model setzen (evcc oder legacy_direct).",
		};
	}

	if (controlModel === "evcc") {
		const contract = resolveEvccModeControlContract(c);
		const modeMappingAvailable =
			contract.resolvedVariant === "buttons"
				? contract.buttonsReady
				: contract.resolvedVariant === "pv_control"
					? Boolean(contract.pvControlStateId)
					: evccControlTargetForRole(c, "set_mode").length > 0;
		const maxCurrentMappingAvailable = Boolean(contract.maxCurrentStateId) ||
			evccControlTargetForRole(c, "set_max_current_a").length > 0;
		const controlMappingComplete = contract.writeContractReady;
		const missing = controlMappingComplete ? [] : [...contract.missing];
		const reasonDe = controlMappingComplete
			? contract.resolvedVariant === "buttons"
				? "EVCC-Button-Contract erkannt (control.off/pv/min/now + status.mode + maxCurrent/phases); produktive Writes weiterhin gesperrt."
				: contract.resolvedVariant === "pv_control"
					? "EVCC-Control-Contract (pvControl/maxCurrent/phasesConfigured) erkannt; produktive Writes weiterhin gesperrt."
					: "EVCC-String-Mode-Mapping grundsätzlich vorhanden; Live-Dispatch weiterhin gesperrt."
			: `Fehlende EVCC-Control-Mappings (${contract.resolvedVariant}): ${missing.join(", ")}.`;
		return {
			controlMappingComplete,
			enableMappingAvailable: false,
			currentMappingAvailable: maxCurrentMappingAvailable,
			powerMappingAvailable: false,
			modeMappingAvailable,
			liveDispatchSupported: false,
			missingMappings: missing,
			reasonDe,
		};
	}

	const legacy = legacyWallboxMappingFromConfig(c);

	const enableMappingAvailable =
		mappingEnabled(c, WALLBOX_FLAT_PREFIX.set_enabled) &&
		(Boolean(legacy.set_enabled?.target_state) || mappingTarget(c, WALLBOX_FLAT_PREFIX.set_enabled).length > 0);
	const currentMappingAvailable =
		mappingEnabled(c, WALLBOX_FLAT_PREFIX.set_current_a) &&
		(Boolean(legacy.set_current_a?.target_state) || mappingTarget(c, WALLBOX_FLAT_PREFIX.set_current_a).length > 0);
	const powerMappingAvailable =
		mappingEnabled(c, WALLBOX_FLAT_PREFIX.set_charge_power_w) &&
		(Boolean(legacy.set_charge_power_w?.target_state) ||
			mappingTarget(c, WALLBOX_FLAT_PREFIX.set_charge_power_w).length > 0);
	const modeMappingAvailable = false;

	const missing: string[] = [];
	if (!enableMappingAvailable) missing.push("set_enabled");
	if (!currentMappingAvailable && !powerMappingAvailable) missing.push("set_current_a|set_charge_power_w");
	if (!modeMappingAvailable) missing.push("evcc_mode_write");

	const controlMappingComplete =
		enableMappingAvailable && (currentMappingAvailable || powerMappingAvailable);

	return {
		controlMappingComplete,
		enableMappingAvailable,
		currentMappingAvailable,
		powerMappingAvailable,
		modeMappingAvailable,
		liveDispatchSupported: false,
		missingMappings: missing,
		reasonDe: controlMappingComplete
			? "Legacy-Write-Mapping grundsätzlich vorhanden; Live-Dispatch in v0.1.133 weiterhin gesperrt."
			: `Fehlende Steuer-Mappings: ${missing.join(", ")}.`,
	};
}

export function powerToTargetCurrentA(
	powerW: number,
	phases: number | null,
	minCurrentA: number | null,
	maxCurrentA: number | null,
): { currentA: number | null; reasonDe: string } {
	if (phases === null || phases <= 0) {
		return { currentA: null, reasonDe: "Phasenanzahl unbekannt — Strom nicht berechenbar." };
	}
	const denom = phases * WALLBOX_AC_VOLTAGE_V;
	if (denom <= 0) {
		return { currentA: null, reasonDe: "Ungültige Phasenkonfiguration." };
	}
	let amps = powerW / denom;
	if (WALLBOX_CURRENT_STEP_A >= 1) {
		amps = Math.round(amps / WALLBOX_CURRENT_STEP_A) * WALLBOX_CURRENT_STEP_A;
	}
	if (minCurrentA !== null && amps < minCurrentA) {
		return {
			currentA: null,
			reasonDe: `Berechneter Strom ${amps} A liegt unter Minimum ${minCurrentA} A.`,
		};
	}
	if (maxCurrentA !== null && amps > maxCurrentA) {
		amps = maxCurrentA;
		if (WALLBOX_CURRENT_STEP_A >= 1) {
			amps = Math.floor(amps / WALLBOX_CURRENT_STEP_A) * WALLBOX_CURRENT_STEP_A;
		}
	}
	if (amps <= 0) {
		return { currentA: null, reasonDe: "Berechneter Strom ist null oder negativ." };
	}
	return { currentA: amps, reasonDe: `Zielstrom ${amps} A bei ${phases} Phasen.` };
}

function resolveDesiredEvccMode(
	readiness: WallboxDispatchReadiness,
	_action: WallboxChargeSource,
): string | null {
	if (!readiness.modeMappingAvailable) return null;
	return null;
}

function resolveDeadlineStatus(decision: WallboxPlanDecision): WallboxDeadlineStatus {
	if (decision.deadlineReachable === true) return "ok";
	if (decision.deadlineReachable === false) return "at_risk";
	return "unknown";
}

function clampTargetPower(
	intent: WallboxDispatchIntent,
	decision: WallboxPlanDecision,
): { powerW: number | null; capped: boolean; reasonDe: string } {
	if (intent.targetPowerW === null || intent.targetPowerW <= 0) {
		return { powerW: 0, capped: false, reasonDe: "" };
	}
	let power = intent.targetPowerW;
	let capped = false;
	if (decision.maxChargePowerW !== null && power > decision.maxChargePowerW) {
		power = decision.maxChargePowerW;
		capped = true;
	}
	if (
		decision.minChargePowerW !== null &&
		power > 0 &&
		power < decision.minChargePowerW
	) {
		return {
			powerW: null,
			capped: false,
			reasonDe: "Die allozierte Leistung liegt unter der technisch möglichen Mindestladeleistung.",
		};
	}
	return {
		powerW: power,
		capped,
		reasonDe: capped ? `Leistung auf technisches Maximum ${power} W begrenzt.` : "",
	};
}

function buildDryrunCommand(
	target: WallboxDispatchTarget,
	telemetry: WallboxTelemetryInput,
	chargingEnabled: boolean | null,
): DryrunCommandEntry[] {
	const entries: DryrunCommandEntry[] = [];
	entries.push({
		role: "set_enabled",
		desiredValue: target.enableCharging,
		currentValue: chargingEnabled,
		writeRequired: target.enableCharging !== chargingEnabled,
	});
	if (target.targetCurrentA !== null) {
		entries.push({
			role: "set_current_a",
			desiredValue: target.targetCurrentA,
			currentValue: null,
			writeRequired: true,
		});
	}
	if (target.targetPowerW !== null && target.targetPowerW > 0) {
		entries.push({
			role: "set_charge_power_w",
			desiredValue: target.targetPowerW,
			currentValue: telemetry.chargePowerW,
			writeRequired: true,
		});
	}
	if (target.desiredEvccMode) {
		entries.push({
			role: "evcc_mode",
			desiredValue: target.desiredEvccMode,
			currentValue: null,
			writeRequired: true,
		});
	}
	return entries;
}

export interface RunWallboxDryrunDispatchInput {
	intent: WallboxDispatchIntent;
	decision: WallboxPlanDecision;
	telemetry: WallboxTelemetryInput;
	config: unknown;
	chargingEnabled: boolean | null;
	governanceEnabled: boolean;
}

export function runWallboxDryrunDispatch(input: RunWallboxDryrunDispatchInput): WallboxDryrunDispatchResult {
	const cacheKey: DispatchCacheKey = {
		revision: input.intent.dailyPlanRevision,
		connected: input.decision.connected,
		action: input.intent.action,
		targetPowerW: input.intent.targetPowerW,
		phases: input.intent.phases,
		governance: input.governanceEnabled,
	};
	if (
		lastCacheKey &&
		lastResult &&
		lastCacheKey.revision === cacheKey.revision &&
		lastCacheKey.connected === cacheKey.connected &&
		lastCacheKey.action === cacheKey.action &&
		lastCacheKey.targetPowerW === cacheKey.targetPowerW &&
		lastCacheKey.phases === cacheKey.phases &&
		lastCacheKey.governance === cacheKey.governance
	) {
		return lastResult;
	}

	const readiness = evaluateWallboxDispatchReadiness(input.config);
	const deadlineStatus = resolveDeadlineStatus(input.decision);

	if (input.intent.action === "none") {
		const result: WallboxDryrunDispatchResult = {
			dispatchStatus: "none",
			dispatchReasonDe: `Dryrun — keine Wallbox-Kommandos ausgeführt. ${input.intent.reasonDe}`,
			intent: input.intent,
			target: {
				action: "none",
				enableCharging: false,
				targetPowerW: 0,
				targetCurrentA: null,
				phases: input.intent.phases,
				desiredEvccMode: null,
				source: input.intent.source,
				valid: true,
				reasonDe: input.intent.reasonDe,
			},
			readiness,
			deadlineStatus,
			dryrunCommand: [],
		};
		lastCacheKey = cacheKey;
		lastResult = result;
		return result;
	}

	if (input.intent.action === "hold") {
		const result: WallboxDryrunDispatchResult = {
			dispatchStatus: "hold",
			dispatchReasonDe: `Dryrun — Hold-Ziel; es wurde kein EVCC-Kommando ausgeführt. ${input.intent.reasonDe}`,
			intent: input.intent,
			target: {
				action: "hold",
				enableCharging: false,
				targetPowerW: 0,
				targetCurrentA: null,
				phases: input.intent.phases,
				desiredEvccMode: null,
				source: input.intent.source,
				valid: true,
				reasonDe: input.intent.reasonDe,
			},
			readiness,
			deadlineStatus,
			dryrunCommand: buildDryrunCommand({
				action: "hold",
				enableCharging: false,
				targetPowerW: 0,
				targetCurrentA: null,
				phases: input.intent.phases,
				desiredEvccMode: null,
				source: input.intent.source,
				valid: true,
				reasonDe: input.intent.reasonDe,
			}, input.telemetry, input.chargingEnabled),
		};
		lastCacheKey = cacheKey;
		lastResult = result;
		return result;
	}

	const clamp = clampTargetPower(input.intent, input.decision);
	if (clamp.powerW === null) {
		const holdIntent = { ...input.intent, action: "hold" as const, enabled: false, targetPowerW: 0 };
		const result: WallboxDryrunDispatchResult = {
			dispatchStatus: "degraded",
			dispatchReasonDe: `Dryrun — ${clamp.reasonDe} Kein EVCC-Kommando ausgeführt.`,
			intent: holdIntent,
			target: {
				action: "hold",
				enableCharging: false,
				targetPowerW: 0,
				targetCurrentA: null,
				phases: input.intent.phases,
				desiredEvccMode: null,
				source: input.intent.source,
				valid: false,
				reasonDe: clamp.reasonDe,
			},
			readiness,
			deadlineStatus,
			dryrunCommand: [],
		};
		lastCacheKey = cacheKey;
		lastResult = result;
		return result;
	}

	const phases = input.intent.phases ?? input.telemetry.activePhases ?? input.telemetry.configuredPhases;
	const current = powerToTargetCurrentA(
		clamp.powerW,
		phases,
		input.telemetry.minCurrentA,
		input.telemetry.maxCurrentA,
	);

	if (current.currentA === null) {
		const result: WallboxDryrunDispatchResult = {
			dispatchStatus: "degraded",
			dispatchReasonDe: `Dryrun — ${current.reasonDe} Kein EVCC-Kommando ausgeführt.`,
			intent: { ...input.intent, enabled: false, action: "hold", targetPowerW: 0 },
			target: {
				action: "hold",
				enableCharging: false,
				targetPowerW: 0,
				targetCurrentA: null,
				phases,
				desiredEvccMode: null,
				source: input.intent.source,
				valid: false,
				reasonDe: current.reasonDe,
			},
			readiness,
			deadlineStatus,
			dryrunCommand: [],
		};
		lastCacheKey = cacheKey;
		lastResult = result;
		return result;
	}

	const desiredMode = resolveDesiredEvccMode(readiness, input.intent.source);
	let targetReason = input.intent.reasonDe;
	if (clamp.capped) targetReason = `${clamp.reasonDe} ${targetReason}`;
	if (deadlineStatus === "at_risk") {
		targetReason = `${targetReason} Deadline voraussichtlich nicht erreichbar (Diagnose).`;
	}
	targetReason = `Dryrun-Ziel: Laden mit ${current.currentA} A (${clamp.powerW} W); es wurde kein EVCC-Kommando ausgeführt. ${targetReason}`;

	const target: WallboxDispatchTarget = {
		action: "charge",
		enableCharging: true,
		targetPowerW: clamp.powerW,
		targetCurrentA: current.currentA,
		phases,
		desiredEvccMode: desiredMode,
		source: input.intent.source,
		valid: true,
		reasonDe: targetReason,
	};

	const result: WallboxDryrunDispatchResult = {
		dispatchStatus: "charge_planned",
		dispatchReasonDe: targetReason,
		intent: {
			...input.intent,
			targetPowerW: clamp.powerW,
			targetCurrentA: current.currentA,
			phases,
		},
		target,
		readiness,
		deadlineStatus,
		dryrunCommand: buildDryrunCommand(target, input.telemetry, input.chargingEnabled),
	};

	lastCacheKey = cacheKey;
	lastResult = result;
	return result;
}
