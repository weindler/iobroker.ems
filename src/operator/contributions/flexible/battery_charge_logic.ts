import type { PlannerModePolicy } from "../../../planner/mode_policy";

/**
 * PV-Defizit-Ladelogik ("Batterie-Lade-Logik", vormals "Battery Winter").
 *
 * Bewusst NICHT jahreszeitgebunden benannt: Der Auslöser ist ein mehrtägiges PV-Defizit
 * (PV-Horizont deckt den Hauslast-Bedarf nicht) — das kann ebenso im Sommer bei mehreren
 * schlechten/bewölkten Tagen auftreten. Die Jahreszeit ist höchstens ein Nebensignal
 * (z. B. Schnee-Verdacht auf den Modulen), nie der Namensgeber.
 *
 * Liefert nur den Energiebedarf (`chargeEnergyKwh`) und eine Deadline (`bridgeUntilIso`) —
 * die eigentliche Slot-/Preisauswahl übernimmt die Daily-Plan-Allocation (deadline-basiert,
 * preissortiert), analog zum Heizstab-Learning-Deadline-Muster aus Block 1.
 */

export interface BatteryChargeLogicDayInput {
	dayIndex: number;
	dateKey: string;
	pvKwh: number | null;
	loadKwh: number | null;
	pvConfidencePct: number | null;
}

export interface BatteryChargeLogicConfig {
	enabled: boolean;
	horizonDays: number;
	marginKwh: number;
	pvRecoveryRatio: number;
	reserveLowConfidenceFactor: number;
	maxSocPct: number;
	minSocPct: number;
	capacityKwh: number | null;
}

export interface BatteryChargeLogicInput {
	now: Date;
	socPct: number | null;
	/** Ein PV-Defizit-Signal unter mehreren (z. B. Schnee/Vollabdeckung) — nie alleiniger Auslöser. */
	snowCoverSuspected: boolean;
	config: BatteryChargeLogicConfig;
	modePolicy: PlannerModePolicy;
	governanceEnabled: boolean;
	days: BatteryChargeLogicDayInput[];
}

export interface BatteryChargeLogicDecision {
	active: boolean;
	forecastActive: boolean;
	horizonDays: number;
	bridgeUntilIso: string | null;
	pvRecoveryDay: number | null;
	energyStoredKwh: number | null;
	energyDeficitKwh: number | null;
	energyReserveKwh: number | null;
	energyTargetKwh: number | null;
	socTargetPct: number | null;
	chargeEnergyKwh: number | null;
	confidenceMinPct: number | null;
	reasonDe: string;
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

function comfortReserveFactor(modePolicy: PlannerModePolicy): number {
	if (modePolicy.mode === "comfort" || modePolicy.mode === "forced") return 1.35;
	if (modePolicy.mode === "eco") return 0.85;
	return 1;
}

function findRecoveryDay(
	days: BatteryChargeLogicDayInput[],
	pvRecoveryRatio: number,
): { recoveryIndex: number | null; scanDays: number } {
	for (let i = 0; i < days.length; i++) {
		const d = days[i];
		if (d.pvKwh === null || d.loadKwh === null || d.loadKwh <= 0) continue;
		if (d.pvKwh >= d.loadKwh * pvRecoveryRatio) {
			return { recoveryIndex: i, scanDays: i + 1 };
		}
	}
	return { recoveryIndex: null, scanDays: days.length };
}

function reserveFromConfidence(
	days: BatteryChargeLogicDayInput[],
	scanDays: number,
	baseReserveKwh: number,
	factor: number,
	modeFactor: number,
): { reserveKwh: number; minConfidence: number | null } {
	let reserve = baseReserveKwh * modeFactor;
	let minConf: number | null = null;
	for (let i = 0; i < scanDays; i++) {
		const d = days[i];
		if (d.loadKwh === null || d.pvConfidencePct === null) continue;
		if (minConf === null || d.pvConfidencePct < minConf) minConf = d.pvConfidencePct;
		if (d.pvConfidencePct < 70 && d.loadKwh > 0) {
			const uncertainty = (70 - d.pvConfidencePct) / 100;
			reserve += d.loadKwh * uncertainty * factor;
		}
	}
	if (days.some((d) => d.pvKwh === null || d.loadKwh === null)) {
		reserve += baseReserveKwh * 0.5 * modeFactor;
	}
	return { reserveKwh: round3(reserve), minConfidence: minConf };
}

/**
 * Read-only Mehr-Tages-Bilanz für PV-Defizit-Netzladung (keine Gerätewrites — nur Bedarf +
 * Deadline für die Daily-Plan-Allocation).
 */
export function planBatteryChargeLogic(input: BatteryChargeLogicInput): BatteryChargeLogicDecision {
	const inactive = (reason: string, forecastActive = false): BatteryChargeLogicDecision => ({
		active: false,
		forecastActive,
		horizonDays: input.config.horizonDays,
		bridgeUntilIso: null,
		pvRecoveryDay: null,
		energyStoredKwh: null,
		energyDeficitKwh: null,
		energyReserveKwh: null,
		energyTargetKwh: null,
		socTargetPct: null,
		chargeEnergyKwh: null,
		confidenceMinPct: null,
		reasonDe: reason,
	});

	if (!input.config.enabled) {
		return inactive("Batterie-Lade-Logik deaktiviert (bat_winter_plan_enabled).");
	}
	if (!input.governanceEnabled) {
		return inactive("Batterie-Governance aus — keine PV-Defizit-Ladeplanung.");
	}
	if (input.modePolicy.mode === "off") {
		return inactive(`${input.modePolicy.labelDe} — keine PV-Defizit-Ladeplanung.`);
	}

	const cap = input.config.capacityKwh;
	if (cap === null || !(cap > 0)) {
		return inactive("Keine gültige Batteriekapazität in Config — Batterie-Lade-Logik pausiert.");
	}
	if (input.socPct === null || !Number.isFinite(input.socPct)) {
		return inactive("SOC unbekannt — Batterie-Lade-Logik pausiert.");
	}

	const days = input.days.slice(0, input.config.horizonDays);
	if (days.length === 0) {
		return inactive("Keine Horizont-Tagesdaten — Batterie-Lade-Logik pausiert.");
	}

	const energyStored = round3((input.socPct / 100) * cap);
	const { recoveryIndex, scanDays } = findRecoveryDay(days, input.config.pvRecoveryRatio);
	const bridgeOffset = recoveryIndex ?? scanDays - 1;
	const bridgeEnd = new Date(input.now);
	bridgeEnd.setHours(23, 59, 59, 999);
	bridgeEnd.setDate(bridgeEnd.getDate() + bridgeOffset);
	const bridgeUntil = bridgeEnd.toISOString();

	let cumPv = 0;
	let cumLoad = 0;
	for (let i = 0; i < scanDays; i++) {
		cumPv += days[i].pvKwh ?? 0;
		cumLoad += days[i].loadKwh ?? 0;
	}

	const netWithoutGrid = energyStored + cumPv - cumLoad;
	const energyDeficitRaw = netWithoutGrid < 0 ? round3(-netWithoutGrid) : 0;
	let energyDeficit = energyDeficitRaw;

	if (input.snowCoverSuspected && energyDeficitRaw > 0) {
		energyDeficit = round3(energyDeficit + input.config.marginKwh);
	}

	const modeFactor = comfortReserveFactor(input.modePolicy);
	const { reserveKwh, minConfidence } = reserveFromConfidence(
		days,
		scanDays,
		input.config.marginKwh,
		input.config.reserveLowConfidenceFactor,
		modeFactor,
	);

	const reserveApplied = energyDeficitRaw > 0 ? reserveKwh : 0;
	const energyTarget = round3(Math.min(cap, energyStored + energyDeficit + reserveApplied));
	const chargeEnergy = round3(Math.max(0, energyTarget - energyStored));

	const maxSoc = input.config.maxSocPct;
	const minSoc = input.config.minSocPct;
	let socTarget = round1((energyTarget / cap) * 100);
	socTarget = Math.min(maxSoc, Math.max(minSoc, socTarget));

	const recoveryDayHuman = recoveryIndex !== null ? recoveryIndex + 1 : null;

	const parts: string[] = [
		`PV-Defizit-Horizont ${scanDays} Tag(e)`,
		recoveryDayHuman ? `PV-Recovery Tag ${recoveryDayHuman}` : `kein Recovery in ${scanDays} Tagen`,
		`SOC ${input.socPct.toFixed(0)} %`,
	];
	if (chargeEnergy > 0) {
		parts.push(`Netz-Ziel +${chargeEnergy.toFixed(1)} kWh → ${socTarget.toFixed(0)} %`);
	} else {
		parts.push("kein Netzladen nötig");
	}
	if (input.snowCoverSuspected) parts.push("Schnee/Vollabdichtung — konservativ");
	if (minConfidence !== null && minConfidence < 70) {
		parts.push(`niedrige PV-Confidence min ${minConfidence.toFixed(0)} %`);
	}
	parts.push(input.modePolicy.labelDe);

	return {
		active: chargeEnergy > 0,
		forecastActive: true,
		horizonDays: scanDays,
		bridgeUntilIso: bridgeUntil,
		pvRecoveryDay: recoveryDayHuman,
		energyStoredKwh: energyStored,
		energyDeficitKwh: energyDeficit,
		energyReserveKwh: reserveKwh,
		energyTargetKwh: energyTarget,
		socTargetPct: socTarget,
		chargeEnergyKwh: chargeEnergy > 0 ? chargeEnergy : null,
		confidenceMinPct: minConfidence,
		reasonDe: parts.join("; ") + ".",
	};
}
