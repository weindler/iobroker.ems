/**
 * Learning → Admin-Config Reconciliation für AC estimated_power_w.
 *
 * Learned Power gilt sofort für Planner/Runtime (resolveConsumerEffectivePowerW).
 * Persistierter Admin-Nominal wird nur pending vorgemerkt.
 *
 * updateConfig() → js-controller Instanz-Neustart. Deshalb Flush NUR wenn:
 * - global.execution_mode != live (Dryrun/off)
 * - kein Restore aktiv
 * - optional: keine laufende AC-/Heizstab-Aktion
 * Alle Units gebündelt in einem updateConfig. Nie automatisch während Global Live.
 */

import {
	LEARNED_POWER_LOOKBACK_DAYS,
	LEARNED_POWER_MIN_DAY_RUNTIME_SEC,
	collectRecentDayMetrics,
} from "../../../learning/consumer_stats/learned_power";
import type { ConsumerPersistEntry } from "../../../learning/consumer_stats/types";
import { parseMode } from "../../../execution_mode";
import { isRestoreInProgress } from "../../../restore/barrier";
import { GLOBAL } from "../../../tree_paths";

/** Strenger als Runtime-Learned (3): Admin-Write braucht mehr unabhängige Tage. */
export const AC_POWER_RECONCILE_MIN_SAMPLE_DAYS = 5;
/** Relative Spannweite (max−min)/median — darüber gilt Learning als instabil. */
export const AC_POWER_RECONCILE_MAX_REL_SPAN = 0.18;
/** Mindestabweichung abs. (W) für „relevant“. */
export const AC_POWER_RECONCILE_MIN_ABS_DELTA_W = 10;
/** Mindestabweichung relativ zur Config. */
export const AC_POWER_RECONCILE_MIN_REL_DELTA = 0.02;
/** Mindestabstand zwischen Config-Writes (kein Sample-Spam / Restart-Sturm). */
export const AC_POWER_RECONCILE_COOLDOWN_MS = 6 * 3600_000;

export type AcPowerReconcileDecision = {
	shouldWrite: boolean;
	learnedPowerW: number | null;
	configPowerW: number;
	sampleDays: number;
	relSpan: number | null;
	deltaW: number | null;
	reasonDe: string;
};

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function evaluateAcPowerConfigReconcile(input: {
	configPowerW: number;
	consumerStats: ConsumerPersistEntry | undefined;
	nowMs: number;
	lastReconcileMs?: number | null;
}): AcPowerReconcileDecision {
	const configPowerW = input.configPowerW > 0 ? Math.round(input.configPowerW) : 0;
	const { powerWs } = collectRecentDayMetrics(
		input.consumerStats,
		input.nowMs,
		LEARNED_POWER_LOOKBACK_DAYS,
	);
	const sampleDays = powerWs.length;
	const learned = median(powerWs);
	const learnedPowerW = learned !== null && learned > 0 ? Math.round(learned) : null;

	if (configPowerW <= 0) {
		return {
			shouldWrite: false,
			learnedPowerW,
			configPowerW,
			sampleDays,
			relSpan: null,
			deltaW: null,
			reasonDe: "Keine gültige Config-Leistung.",
		};
	}
	if (sampleDays < AC_POWER_RECONCILE_MIN_SAMPLE_DAYS || learnedPowerW === null) {
		return {
			shouldWrite: false,
			learnedPowerW,
			configPowerW,
			sampleDays,
			relSpan: null,
			deltaW: null,
			reasonDe: `Learning unzureichend (${sampleDays}/${AC_POWER_RECONCILE_MIN_SAMPLE_DAYS} Tage, min ${LEARNED_POWER_MIN_DAY_RUNTIME_SEC}s/Tag).`,
		};
	}

	const minW = Math.min(...powerWs);
	const maxW = Math.max(...powerWs);
	const relSpan = learnedPowerW > 0 ? (maxW - minW) / learnedPowerW : null;
	if (relSpan === null || relSpan > AC_POWER_RECONCILE_MAX_REL_SPAN) {
		return {
			shouldWrite: false,
			learnedPowerW,
			configPowerW,
			sampleDays,
			relSpan,
			deltaW: learnedPowerW - configPowerW,
			reasonDe: `Learning instabil (rel. Spannweite ${(relSpan ?? 0).toFixed(2)} > ${AC_POWER_RECONCILE_MAX_REL_SPAN}).`,
		};
	}

	const deltaW = learnedPowerW - configPowerW;
	const absDelta = Math.abs(deltaW);
	const relDelta = absDelta / configPowerW;
	if (absDelta < AC_POWER_RECONCILE_MIN_ABS_DELTA_W && relDelta < AC_POWER_RECONCILE_MIN_REL_DELTA) {
		return {
			shouldWrite: false,
			learnedPowerW,
			configPowerW,
			sampleDays,
			relSpan,
			deltaW,
			reasonDe: `Abweichung nicht relevant (Δ ${deltaW} W).`,
		};
	}

	if (learnedPowerW === configPowerW) {
		return {
			shouldWrite: false,
			learnedPowerW,
			configPowerW,
			sampleDays,
			relSpan,
			deltaW: 0,
			reasonDe: "Config entspricht bereits dem gelernten Median.",
		};
	}

	const last = input.lastReconcileMs ?? null;
	if (last !== null && input.nowMs - last < AC_POWER_RECONCILE_COOLDOWN_MS) {
		return {
			shouldWrite: false,
			learnedPowerW,
			configPowerW,
			sampleDays,
			relSpan,
			deltaW,
			reasonDe: "Cooldown aktiv — kein erneuter Config-Write.",
		};
	}

	return {
		shouldWrite: true,
		learnedPowerW,
		configPowerW,
		sampleDays,
		relSpan,
		deltaW,
		reasonDe: `Config ${configPowerW} W → gelernt ${learnedPowerW} W (${sampleDays} stabile Tage).`,
	};
}

export type AcPowerReconcileHost = {
	config?: unknown;
	updateConfig?: (newConfig: Record<string, unknown>) => Promise<unknown>;
	getStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	log?: { info: (m: string) => void; debug?: (m: string) => void; warn?: (m: string) => void };
};

type PendingWrite = { learnedPowerW: number; reasonDe: string };

/** Vorgemerkte Admin-Writes — warten auf Non-Live + Idle. */
const pendingByUnit = new Map<number, PendingWrite>();
const lastReconcileByUnit = new Map<number, { ms: number; powerW: number }>();

export function resetAcPowerReconcileMemoryForTests(): void {
	pendingByUnit.clear();
	lastReconcileByUnit.clear();
}

export function getPendingAcPowerReconcileForTests(): Map<number, PendingWrite> {
	return new Map(pendingByUnit);
}

/** Merkt Unit vor; schreibt NICHT (kein Restart). */
export function queueAcPowerConfigReconcile(input: {
	unitIndex: number;
	configPowerW: number;
	consumerStats: ConsumerPersistEntry | undefined;
	nowMs: number;
}): AcPowerReconcileDecision & { queued: boolean } {
	const prev = lastReconcileByUnit.get(input.unitIndex);
	const decision = evaluateAcPowerConfigReconcile({
		configPowerW: input.configPowerW,
		consumerStats: input.consumerStats,
		nowMs: input.nowMs,
		lastReconcileMs: prev?.ms ?? null,
	});
	if (!decision.shouldWrite || decision.learnedPowerW === null) {
		return { ...decision, queued: false };
	}
	if (prev && prev.powerW === decision.learnedPowerW) {
		return {
			...decision,
			shouldWrite: false,
			queued: false,
			reasonDe: "Zielwert bereits geschrieben.",
		};
	}
	pendingByUnit.set(input.unitIndex, {
		learnedPowerW: decision.learnedPowerW,
		reasonDe: decision.reasonDe,
	});
	return { ...decision, queued: true };
}

/**
 * Hartes Flush-Gate für updateConfig-Neustart.
 * Global Live und Restore blockieren immer — auch bei idle AC/Heizstab.
 */
export async function isSafeForAcConfigRestart(host: AcPowerReconcileHost): Promise<{
	safe: boolean;
	reasonDe: string;
}> {
	if (isRestoreInProgress()) {
		return { safe: false, reasonDe: "Restore aktiv — kein Config-Restart." };
	}

	if (typeof host.getStateAsync === "function") {
		const globalSt = await host.getStateAsync(GLOBAL.executionMode);
		const globalMode = parseMode(globalSt?.val);
		if (globalMode === "live") {
			return {
				safe: false,
				reasonDe: "Global Live — kein automatischer Config-Restart (Pending bleibt).",
			};
		}

		for (let i = 1; i <= 5; i++) {
			const running = await host.getStateAsync(`addons.air_conditioning.unit_${i}.running`);
			if (running?.val === true) {
				return { safe: false, reasonDe: `AC Unit ${i} läuft — Config-Write zurückgestellt.` };
			}
			const cleaning = await host.getStateAsync(`addons.air_conditioning.unit_${i}.cleaning_active`);
			if (cleaning?.val === true) {
				return { safe: false, reasonDe: `AC Unit ${i} Reinigung — Config-Write zurückgestellt.` };
			}
		}
		const ihStage = await host.getStateAsync("addons.immersion_heater.runtime.commanded_stage");
		const stageN = typeof ihStage?.val === "number" ? ihStage.val : Number(ihStage?.val);
		if (Number.isFinite(stageN) && stageN > 0) {
			return { safe: false, reasonDe: "Heizstab aktiv (Stufe > 0) — Config-Write zurückgestellt." };
		}
	} else {
		// Ohne State-API: konservativ kein Flush (außer Tests setzen devicesBusy=false + mock getState).
		return {
			safe: false,
			reasonDe: "Kein getStateAsync — Config-Write nicht möglich zu prüfen.",
		};
	}

	return {
		safe: true,
		reasonDe: "Non-Live + Idle — gebündelter Config-Write erlaubt (Neustart folgt).",
	};
}

/**
 * Schreibt alle vorgemerkten ac_u*_estimated_power_w in EINEM updateConfig.
 * Global Live / Restore können nicht per Override umgangen werden.
 */
export async function flushQueuedAcPowerConfigReconcile(input: {
	host: AcPowerReconcileHost;
	nowMs: number;
	/** Zusätzlicher Busy-Hinweis aus dem AC-Tick (kann Flush nur blockieren). */
	devicesBusy?: boolean;
}): Promise<{ wrote: boolean; deferred: boolean; reasonDe: string; units: number[] }> {
	if (pendingByUnit.size === 0) {
		return { wrote: false, deferred: false, reasonDe: "Nichts vorgemerkt.", units: [] };
	}
	if (typeof input.host.updateConfig !== "function") {
		return {
			wrote: false,
			deferred: true,
			reasonDe: "updateConfig nicht verfügbar — Pending bleibt.",
			units: [...pendingByUnit.keys()],
		};
	}

	const gate = await isSafeForAcConfigRestart(input.host);
	let safe = gate.safe;
	let reasonDe = gate.reasonDe;
	if (safe && input.devicesBusy) {
		safe = false;
		reasonDe = "AC-Gerät aktiv im Tick — Config-Write zurückgestellt.";
	}

	if (!safe) {
		input.host.log?.debug?.(
			`ac power reconcile deferred (${pendingByUnit.size} units): ${reasonDe}`,
		);
		return {
			wrote: false,
			deferred: true,
			reasonDe,
			units: [...pendingByUnit.keys()],
		};
	}

	const base =
		input.host.config && typeof input.host.config === "object"
			? { ...(input.host.config as Record<string, unknown>) }
			: {};
	const units: number[] = [];
	const reasons: string[] = [];
	for (const [unitIndex, pending] of pendingByUnit) {
		const key = `ac_u${unitIndex}_estimated_power_w`;
		if (Number(base[key]) === pending.learnedPowerW) {
			lastReconcileByUnit.set(unitIndex, { ms: input.nowMs, powerW: pending.learnedPowerW });
			continue;
		}
		base[key] = pending.learnedPowerW;
		units.push(unitIndex);
		reasons.push(`u${unitIndex}: ${pending.reasonDe}`);
		lastReconcileByUnit.set(unitIndex, { ms: input.nowMs, powerW: pending.learnedPowerW });
	}
	pendingByUnit.clear();

	if (units.length === 0) {
		return {
			wrote: false,
			deferred: false,
			reasonDe: "Native Config bereits aktuell.",
			units: [],
		};
	}

	await input.host.updateConfig(base);
	if (input.host.config && typeof input.host.config === "object") {
		for (const unitIndex of units) {
			const key = `ac_u${unitIndex}_estimated_power_w`;
			(input.host.config as Record<string, unknown>)[key] = base[key];
		}
	}
	const msg = `ac power reconcile write (restart follows): ${reasons.join("; ")}`;
	input.host.log?.info?.(msg);
	return { wrote: true, deferred: false, reasonDe: msg, units };
}
