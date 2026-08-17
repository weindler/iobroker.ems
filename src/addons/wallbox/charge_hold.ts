/**
 * Einzige Authority: Hausbatterie-Hold wegen einer realen EV-Aktion.
 *
 * Kein nachgelagerter Pfad (Planner-Constraints, Grid-Balance, VIS) darf aus
 * EVCC-Rohsignalen (z. B. mode=now bei getrenntem Fahrzeug) eine EV-Aktion
 * oder einen Batterie-Hold rekonstruieren.
 *
 * Hold nur wenn das Fahrzeug verbunden ist UND eine nachweisbare EV-Ladung
 * bzw. eine explizite externe Hoheit (Tibber Rewards) vorliegt.
 * Leftover EVCC now / Boost ohne Verbindung oder ohne Ladung ist kein Hold.
 */

export const EV_CHARGE_ACTION_MIN_W = 50;

export interface WallboxBatteryHoldInput {
	/** EVCC/Runtime: Fahrzeug an der Wallbox. false → niemals Hold/EV-Aktion. */
	vehicleConnected: boolean | null;
	charging: boolean | null;
	chargePowerW: number | null;
	batteryBoost: boolean | null;
	/** Loadpoint-Modus, z. B. "now" / "pv" / "minpv". */
	loadpointMode: string | null;
	/** HA Ford `elvehcharging` o. ä. — string oder bool. */
	externalVehicleChargeRaw: string | boolean | null;
	/** Nur bei explizit `true` aktiv; false/null ignorieren. */
	tibberGridRewardsActive: boolean | null;
}

export interface WallboxBatteryHoldResult {
	hold: boolean;
	boostActive: boolean;
	externalActive: boolean;
	tibberRewardsActive: boolean;
	reasonDe: string;
}

export function isEvVehiclePresent(connected: boolean | null | undefined): boolean {
	return connected === true;
}

export function isEvActuallyCharging(input: {
	charging?: boolean | null;
	chargePowerW?: number | null;
	minW?: number;
}): boolean {
	if (input.charging === true) return true;
	const p = input.chargePowerW;
	const min = input.minW ?? EV_CHARGE_ACTION_MIN_W;
	return p != null && Number.isFinite(p) && p >= min;
}

/** Interpretiert HA-/Fremd-Ladestatus konservativ (unbekannt → nicht aktiv). */
export function interpretExternalVehicleCharge(raw: string | boolean | null): boolean {
	if (raw === null || raw === undefined) return false;
	if (typeof raw === "boolean") return raw;

	const s = String(raw).trim();
	if (!s) return false;
	const lower = s.toLowerCase();

	if (lower === "complete" || lower === "completed" || lower === "ready") return false;
	if (lower === "not_ready" || lower === "disconnected" || lower === "idle") return false;
	if (lower === "false" || lower === "0" || lower === "off" || lower === "no") return false;
	if (lower === "true" || lower === "1" || lower === "on" || lower === "yes") return true;

	if (lower === "charging" || lower === "chargingac" || lower === "chargingdc") return true;
	if (lower === "in_progress" || lower === "in-progress" || lower === "inprogress") return true;

	// Enthält "charg", aber nicht "not" (z. B. "not charging" / NOT_READY).
	if (lower.includes("charg") && !lower.includes("not")) return true;

	return false;
}

/** PV-/Überschuss-Modi: HA „Charging“ ist hier normales EVCC-Laden → kein External-Hold. */
function isPvSurplusLoadpointMode(mode: string): boolean {
	return mode === "pv" || mode === "minpv" || mode === "min+pv" || mode === "solar";
}

function normalizeLoadpointMode(raw: string | null | undefined): string {
	return String(raw ?? "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "");
}

export function resolveWallboxBatteryHold(input: WallboxBatteryHoldInput): WallboxBatteryHoldResult {
	const none = (reasonDe: string): WallboxBatteryHoldResult => ({
		hold: false,
		boostActive: false,
		externalActive: false,
		tibberRewardsActive: false,
		reasonDe,
	});

	if (!isEvVehiclePresent(input.vehicleConnected)) {
		return none("Kein Fahrzeug verbunden — kein EV-Batterie-Hold (EVCC-Modus allein ist keine EV-Aktion).");
	}

	const mode = normalizeLoadpointMode(input.loadpointMode);
	const actuallyCharging = isEvActuallyCharging({
		charging: input.charging,
		chargePowerW: input.chargePowerW,
	});
	const boostMode = input.batteryBoost === true || mode === "now";
	const boostActive = boostMode && actuallyCharging;
	const externalRawActive = interpretExternalVehicleCharge(input.externalVehicleChargeRaw);
	const externalActive = externalRawActive && actuallyCharging && !isPvSurplusLoadpointMode(mode);
	const tibberRewardsActive = input.tibberGridRewardsActive === true;
	const hold = boostActive || externalActive || tibberRewardsActive;

	const parts: string[] = [];
	if (boostActive) {
		if (input.batteryBoost === true && mode === "now") {
			parts.push("EVCC Boost/Sofortladen (batteryBoost + mode=now, Fahrzeug lädt)");
		} else if (input.batteryBoost === true) {
			parts.push("EVCC batteryBoost aktiv (Fahrzeug lädt)");
		} else {
			parts.push("EVCC Loadpoint-Modus now bei verbundener Ladung");
		}
	}
	if (externalActive) parts.push("externes Fahrzeugladen aktiv");
	if (tibberRewardsActive) parts.push("Tibber Grid Rewards aktiv");

	return {
		hold,
		boostActive,
		externalActive,
		tibberRewardsActive,
		reasonDe: hold
			? `Hausbatterie-Hold für EV-Laden: ${parts.join(", ")}.`
			: "Kein Wallbox-Batterie-Hold (kein verbundenes Laden / keine externe Hoheit).",
	};
}
