/**
 * Pfadspezifische Erfahrung η = spätere Entladung / eindeutige Ladung.
 * Kein Tages-charge/discharge-Quotient, keine Jahreswerte als operative η.
 */

import {
	ETA_PATH_FALLBACK,
	ETA_PLAUSIBLE_MAX,
	ETA_PLAUSIBLE_MIN,
	MIN_ETA_ENERGY_KWH,
	MIN_ETA_SESSIONS,
} from "./constants";
import { emptyEtaPath, type ChargeSource, type EtaPathLearning } from "./types";

export type ChargeDischargeSession = {
	source: "pv" | "grid";
	chargeKwh: number;
	dischargeKwh: number;
};

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const s = values.slice().sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function pathFromSessions(sessions: ChargeDischargeSession[], source: "pv" | "grid"): {
	eta: number | null;
	usable: boolean;
	count: number;
} {
	const etas: number[] = [];
	for (const s of sessions) {
		if (s.source !== source) continue;
		if (!(s.chargeKwh >= MIN_ETA_ENERGY_KWH) || !(s.dischargeKwh >= 0)) continue;
		const eta = s.dischargeKwh / s.chargeKwh;
		if (!Number.isFinite(eta)) continue;
		if (eta < ETA_PLAUSIBLE_MIN || eta > ETA_PLAUSIBLE_MAX) continue;
		etas.push(eta);
	}
	const m = median(etas);
	return {
		eta: m,
		usable: m != null && etas.length >= MIN_ETA_SESSIONS,
		count: etas.length,
	};
}

export function learnEtaPaths(sessions: ChargeDischargeSession[]): EtaPathLearning {
	const pv = pathFromSessions(sessions, "pv");
	const grid = pathFromSessions(sessions, "grid");
	if (!pv.usable && !grid.usable) {
		return {
			...emptyEtaPath("Keine ausreichend eindeutigen Energiepfade — 92 %-Fallback."),
			pvSessionCount: pv.count,
			gridSessionCount: grid.count,
			etaPvPath: pv.eta,
			etaGridPath: grid.eta,
		};
	}
	return {
		etaPvPath: pv.eta,
		etaGridPath: grid.eta,
		etaPvUsable: pv.usable,
		etaGridUsable: grid.usable,
		pvSessionCount: pv.count,
		gridSessionCount: grid.count,
		reasonDe: `Pfad-η PV ${pv.usable ? "usable" : "Fallback"} (${pv.count}), Netz ${grid.usable ? "usable" : "Fallback"} (${grid.count}).`,
	};
}

export function etaForPath(learning: EtaPathLearning, path: "pv" | "grid"): number {
	if (path === "pv") return learning.etaPvUsable && learning.etaPvPath != null ? learning.etaPvPath : ETA_PATH_FALLBACK;
	return learning.etaGridUsable && learning.etaGridPath != null ? learning.etaGridPath : ETA_PATH_FALLBACK;
}

/**
 * Aus Slot-Reihen eindeutige Lade→Entlade-Sessions ableiten.
 * mixed/unknown unterbrechen den Pfad (keine Zuordnung).
 */
export function sessionsFromChargeSlots(input: {
	chargedKwh: Array<number | null>;
	dischargedKwh: Array<number | null>;
	source: Array<ChargeSource | null>;
}): ChargeDischargeSession[] {
	const n = Math.min(input.chargedKwh.length, input.dischargedKwh.length, input.source.length);
	const out: ChargeDischargeSession[] = [];
	let i = 0;
	while (i < n) {
		const src = input.source[i];
		const ch = input.chargedKwh[i];
		if ((src !== "pv" && src !== "grid") || ch == null || !(ch > 0)) {
			i += 1;
			continue;
		}
		const source = src;
		let charge = 0;
		while (i < n) {
			const s = input.source[i];
			const c = input.chargedKwh[i];
			const d = input.dischargedKwh[i];
			if (c != null && c > 0) {
				if (s !== source) break;
				charge += c;
				i += 1;
				continue;
			}
			if (d != null && d > 0) break;
			i += 1;
		}
		let discharge = 0;
		while (i < n) {
			const s = input.source[i];
			const c = input.chargedKwh[i];
			const d = input.dischargedKwh[i];
			if (c != null && c > 0) break;
			if (s === "pv" || s === "grid" || s === "mixed") {
				/* Herkunft während Entladung irrelevant; mixed-Ladung wäre oben schon break. */
			}
			if (d != null && d > 0) discharge += d;
			i += 1;
		}
		if (charge >= MIN_ETA_ENERGY_KWH && discharge > 0) {
			out.push({ source, chargeKwh: charge, dischargeKwh: discharge });
		}
	}
	return out;
}
