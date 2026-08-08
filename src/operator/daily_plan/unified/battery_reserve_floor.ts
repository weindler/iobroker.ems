/**
 * Zeitabhängiger Battery-Reserve-Floor (Befund 004 Ergänzung).
 *
 * requiredBatteryEnergy(t) = unvermeidbarer Bedarf bis zur nächsten PV-/Lade-Recovery
 *   + Sicherheitsreserve (minSoc)
 * usableBatteryEnergy(t) = soc(t) − required(t)  (alles darüber ist flexibel für Verbraucher)
 *
 * Keine festen %-Regeln, keine Writes — nur Planungszahlen für Score-Allocation.
 */

import type { UnifiedDayPlannerInput } from "./types";

export const FLOOR_EPS = 1e-6;

/** Minimale Slot-Sicht für Floor/Recovery (vermeidet Zirkular-Import mit score_allocate). */
export type ReserveFloorSlot = {
	startIso: string;
	endIso: string;
	startMs: number;
	pvKwh: number;
	houseKwh: number;
	importCt: number | null;
};

export type BatteryReserveFloorPlan = {
	/** Pro Slot: Mindest-kWh, die in der Batterie bleiben müssen. */
	requiredKwhBySlot: number[];
	/** Index der nächsten realistischen PV-Recovery; null = Horizon-Ende. */
	recoverySlotIdx: number | null;
	/**
	 * Erwartete Ersatzkosten (ct/kWh) einer jetzt entladenen kWh bis Recovery.
	 * Niedrig bei starker PV-Recovery, hoch bei Knappheit/teurem Netz.
	 */
	replacementCtBySlot: number[];
	reasonDe: string;
};

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/** Lokale Stunde 0–23 aus ISO + IANA-Timezone. */
function localHour(iso: string, timeZone: string): number {
	try {
		const parts = new Intl.DateTimeFormat("en-GB", {
			timeZone,
			hour: "numeric",
			hourCycle: "h23",
		}).formatToParts(new Date(iso));
		const h = Number(parts.find((p) => p.type === "hour")?.value);
		return Number.isFinite(h) ? h : new Date(iso).getUTCHours();
	} catch {
		return new Date(iso).getUTCHours();
	}
}

/**
 * Nächste PV-Recovery: frühester Slot, ab dem in ~12 h genug PV-Überschuss
 * zum Nachladen entsteht (Surplus ≥ 3 kWh oder PV ≥ 8 kWh).
 */
export function findPvRecoverySlotIdx(slots: ReserveFloorSlot[], fromIdx: number): number | null {
	if (slots.length === 0) return null;
	const start = Math.max(0, Math.min(fromIdx, slots.length - 1));
	for (let i = start; i < slots.length; i++) {
		let cumSurplus = 0;
		let cumPv = 0;
		const end = Math.min(slots.length, i + 48); // 12 h
		for (let j = i; j < end; j++) {
			const s = slots[j]!;
			cumPv += s.pvKwh;
			cumSurplus += Math.max(0, s.pvKwh - s.houseKwh);
			// Beide Schwellen: verhindert falsche „Recovery“ aus flachem Minimalsurplus.
			if (
				(cumSurplus >= 3 - FLOOR_EPS && cumPv >= 5 - FLOOR_EPS) ||
				cumPv >= 10 - FLOOR_EPS
			) {
				return i;
			}
		}
	}
	return slots.length - 1;
}

/**
 * Unvermeidbarer Nacht-/Brückenbedarf am Slot i bis Recovery.
 * Nachmittag vor Nacht: voller Night-Reserve halten.
 * In der Nacht: anteilig abschmelzen.
 * Morgen vor Recovery: kleiner Rest-Puffer.
 */
export function unavoidableNeedKwh(opts: {
	slotStartIso: string;
	slotMs: number;
	recoveryMs: number;
	nightReserveKwh: number;
	timeZone: string;
}): number {
	const night = opts.nightReserveKwh;
	if (!(night > FLOOR_EPS)) return 0;

	const hour = localHour(opts.slotStartIso, opts.timeZone);
	const inNight = hour >= 22 || hour < 6;

	// Tag (10–22): volle Nachtreserve für die kommende Nacht — auch wenn Recovery-Heuristik „jetzt“ sagt.
	if (hour >= 10 && hour < 22) return round3(night);

	if (inNight) {
		// Restanteil der Nacht bis 06:00 (8 h Fenster).
		const hoursLeft = hour >= 22 ? 24 - hour + 6 : 6 - hour;
		const frac = Math.max(0, Math.min(1, hoursLeft / 8));
		return round3(night * frac);
	}

	// Morgen 06–10: Kissen bis PV anzieht; nach Recovery kleiner.
	if (opts.slotMs >= opts.recoveryMs) return round3(night * 0.1);
	const hoursToRec = Math.max(0, (opts.recoveryMs - opts.slotMs) / 3600_000);
	if (hoursToRec < 4) return round3(night * 0.12);
	return round3(night * 0.2);
}

/** Erwartete Ersatz-ct/kWh: min Import bis Recovery, ~0 wenn PV reichlich nachlädt. */
export function replacementCostCtPerKwh(
	slots: ReserveFloorSlot[],
	fromIdx: number,
	recoveryIdx: number,
): number {
	let cumSurplus = 0;
	let minImport: number | null = null;
	const end = Math.max(fromIdx, recoveryIdx);
	for (let j = fromIdx; j <= end && j < slots.length; j++) {
		const s = slots[j]!;
		cumSurplus += Math.max(0, s.pvKwh - s.houseKwh);
		if (s.importCt !== null && Number.isFinite(s.importCt)) {
			minImport = minImport === null ? s.importCt : Math.min(minImport, s.importCt);
		}
	}
	if (cumSurplus >= 3 - FLOOR_EPS) {
		// Baldige PV-Recovery → kWh ist billig ersetzbar.
		return Math.min(4, minImport ?? 4);
	}
	if (minImport !== null) return minImport;
	return 28;
}

export function buildBatteryReserveFloor(
	input: UnifiedDayPlannerInput,
	slots: ReserveFloorSlot[],
): BatteryReserveFloorPlan {
	const cap = input.battery.usableCapacityKwh;
	const reservePct = input.battery.reserveSocPct ?? input.battery.minSocPct ?? 0;
	const safetyKwh =
		cap !== null && cap > 0 ? round3(cap * (Math.max(0, reservePct) / 100)) : 0;
	const night =
		input.battery.nightReserveKwh !== null && input.battery.nightReserveKwh > 0
			? input.battery.nightReserveKwh
			: 0;
	const tz = input.time.timezone || "Europe/Berlin";
	const nowMs = Date.parse(input.time.nowIso);
	const fromIdx = Math.max(
		0,
		slots.findIndex((s) => s.startMs + 15 * 60_000 > nowMs),
	);
	const recoverySlotIdx = findPvRecoverySlotIdx(slots, fromIdx);
	const recoveryMs =
		recoverySlotIdx !== null && slots[recoverySlotIdx]
			? slots[recoverySlotIdx]!.startMs
			: slots.length > 0
				? Date.parse(slots[slots.length - 1]!.endIso)
				: nowMs;

	const requiredKwhBySlot: number[] = [];
	const replacementCtBySlot: number[] = [];

	for (let i = 0; i < slots.length; i++) {
		const s = slots[i]!;
		const unavoidable = unavoidableNeedKwh({
			slotStartIso: s.startIso,
			slotMs: s.startMs,
			recoveryMs,
			nightReserveKwh: night,
			timeZone: tz,
		});
		const required = round3(Math.min(cap ?? unavoidable + safetyKwh, Math.max(safetyKwh, unavoidable)));
		requiredKwhBySlot.push(required);
		const recIdx = recoverySlotIdx ?? slots.length - 1;
		replacementCtBySlot.push(replacementCostCtPerKwh(slots, i, recIdx));
	}

	const parts: string[] = [];
	if (night > 0) parts.push(`Nachtreserve ~${night.toFixed(1)} kWh zeitabhängig`);
	if (recoverySlotIdx !== null && slots[recoverySlotIdx]) {
		parts.push(`PV-Recovery ab ${slots[recoverySlotIdx]!.startIso}`);
	}
	parts.push(`Safety ~${safetyKwh.toFixed(1)} kWh`);

	return {
		requiredKwhBySlot,
		recoverySlotIdx,
		replacementCtBySlot,
		reasonDe: parts.join("; ") + ".",
	};
}

export function reserveFloorAt(floor: BatteryReserveFloorPlan, slotIdx: number, fallback: number): number {
	const v = floor.requiredKwhBySlot[slotIdx];
	return v !== undefined && Number.isFinite(v) ? v : fallback;
}

export function usableBatteryEnergyKwh(
	socKwh: number,
	floorKwh: number,
	dischargeEff: number,
): number {
	const drawRoom = socKwh - floorKwh;
	if (!(drawRoom > FLOOR_EPS)) return 0;
	return round3(drawRoom * Math.max(dischargeEff, 0.1));
}
