/**
 * Ladeherkunft: nur zuordnen, wenn EMS sie sicher kennt oder die Lage eindeutig ist.
 * Keine erfundene Zuordnung — sonst unknown/mixed.
 */

import type { ChargeSource } from "./types";

export type ChargeSourceInput = {
	chargingW: number | null;
	pvW: number | null;
	houseW: number | null;
	gridImportW: number | null;
	/** EMS hat selbst Netzladen angeordnet (Setpoint-Owner grid_charge). */
	emsGridChargeActive: boolean;
};

const CHARGE_W_MIN = 50;
const SURPLUS_W_MIN = 80;
const IMPORT_NEAR_ZERO_W = 60;

export function classifyChargeSource(input: ChargeSourceInput): ChargeSource {
	const charge = input.chargingW;
	if (charge == null || !Number.isFinite(charge) || charge < CHARGE_W_MIN) {
		return "unknown";
	}
	if (input.emsGridChargeActive) return "grid";

	const pv = input.pvW;
	const house = input.houseW;
	const imp = input.gridImportW;
	const pvKnown = pv != null && Number.isFinite(pv);
	const houseKnown = house != null && Number.isFinite(house);
	const impKnown = imp != null && Number.isFinite(imp);

	if (pvKnown && houseKnown && pv! > house! + SURPLUS_W_MIN && impKnown && imp! <= IMPORT_NEAR_ZERO_W) {
		return "pv";
	}

	if (
		impKnown &&
		imp! >= charge * 0.7 &&
		(!pvKnown || !houseKnown || pv! <= house! + SURPLUS_W_MIN)
	) {
		return "grid";
	}

	if (pvKnown && houseKnown && pv! > house! + SURPLUS_W_MIN && impKnown && imp! > IMPORT_NEAR_ZERO_W) {
		return "mixed";
	}

	return "unknown";
}

/** Slot-Zusammenführung: Konflikte → mixed, unknown weicht eindeutigen Werten. */
export function mergeChargeSource(prev: ChargeSource | null, next: ChargeSource): ChargeSource {
	if (prev == null || prev === "unknown") return next;
	if (next === "unknown") return prev;
	if (prev === next) return prev;
	return "mixed";
}
