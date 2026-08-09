/**
 * Passive Battery-Energiequelle für Unified-Verbraucher (AC/Wallbox/IH).
 *
 * Kein Discharge-Write — nur Planungsannahme, ob die reale Batterie im
 * autonomen Self-Consumption-Betrieb passiv entladen kann.
 */

export type PassiveBatteryEnergyInput = {
	/** Roher Operating-Mode aus Telemetrie; null = unbekannt. */
	operatingMode: number | null;
	selfConsumptionModeValue: number;
	manualModeValue: number;
	/** EMS besitzt die Batterie (Manual/Charge) → keine verlässliche Passive-Entladung. */
	ownershipActive: boolean;
	/** EMS-Hold (z. B. Wallbox-Charge-Hold) sperrt passive Nutzung. */
	batteryHoldActive?: boolean;
};

export type PassiveBatteryEnergyDecision = {
	available: boolean;
	reasonDe: string;
	reasonCode:
		| "passive_battery_self_consumption"
		| "passive_battery_ownership"
		| "passive_battery_hold"
		| "passive_battery_manual"
		| "passive_battery_mode_unknown"
		| "passive_battery_mode_other";
};

/**
 * Nur Self-Consumption ohne Ownership/Hold gilt als verlässlich passive Quelle.
 * Unbekannter oder Manual-/Sonst-Modus → konservativ gesperrt.
 */
export function resolvePassiveBatteryEnergyAvailable(
	input: PassiveBatteryEnergyInput,
): PassiveBatteryEnergyDecision {
	if (input.ownershipActive) {
		return {
			available: false,
			reasonDe: "Batterie unter EMS-Ownership — keine zugesicherte passive Entladung.",
			reasonCode: "passive_battery_ownership",
		};
	}
	if (input.batteryHoldActive === true) {
		return {
			available: false,
			reasonDe: "Batterie-Hold aktiv — keine zugesicherte passive Entladung.",
			reasonCode: "passive_battery_hold",
		};
	}
	if (input.operatingMode === null || !Number.isFinite(input.operatingMode)) {
		return {
			available: false,
			reasonDe: "Batterie-Betriebsart unbekannt — konservativ keine passive Energiequelle.",
			reasonCode: "passive_battery_mode_unknown",
		};
	}
	if (input.operatingMode === input.manualModeValue) {
		return {
			available: false,
			reasonDe: "Batterie im Manual-/Hold-Modus — keine verlässliche passive Entladung.",
			reasonCode: "passive_battery_manual",
		};
	}
	if (input.operatingMode === input.selfConsumptionModeValue) {
		return {
			available: true,
			reasonDe: "Batterie im Self-Consumption — SOC oberhalb Reserve passiv nutzbar.",
			reasonCode: "passive_battery_self_consumption",
		};
	}
	return {
		available: false,
		reasonDe: "Batterie-Betriebsart erlaubt keine zugesicherte passive Entladung.",
		reasonCode: "passive_battery_mode_other",
	};
}
