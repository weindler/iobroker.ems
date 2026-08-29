import type { AcUnitConfig, AcUnitModePurpose } from "../types";
import { acModeCommandEnabled } from "../config";
import { isHardOffTime, isWithinClockWindow, switchIsOff, switchIsOn } from "./time";
import { coolingDemandUrgency01, dehumidifyDemandUrgency01 } from "./hard_off_worth_it";

export type AcUnitFsmState =
	| "disabled"
	| "idle"
	| "running"
	| "cleaning"
	| "fault";

export type AcUnitFsmInput = {
	now: Date;
	addonEnabled: boolean;
	unit: AcUnitConfig;
	roomTempC: number | null;
	roomHumidityPct: number | null;
	feedbackSwitchRaw: unknown;
	cleaningActive: boolean;
};

export type AcUnitFsmResult = {
	state: AcUnitFsmState;
	demandStart: boolean;
	demandStop: boolean;
	modePurpose: AcUnitModePurpose;
	reasonDe: string;
	/**
	 * 0..1 — aktuelle Komfort-Dringlichkeit (Temp-/Feuchte-Überschreitung), für Hard-Off-Abwägung.
	 * Optional für Rückwärtskompatibilität mit bestehenden Fixtures/Tests; fehlend = 0 (neutral).
	 */
	demandUrgency01?: number;
};

export function evaluateAcUnitFsm(input: AcUnitFsmInput): AcUnitFsmResult {
	const { unit } = input;
	const none = (state: AcUnitFsmState, reasonDe: string): AcUnitFsmResult => ({
		state,
		demandStart: false,
		demandStop: false,
		modePurpose: "cooling",
		reasonDe,
		demandUrgency01: 0,
	});

	if (!input.addonEnabled || !unit.enabled) {
		return none("disabled", "Add-on oder Innengerät deaktiviert.");
	}
	if (input.cleaningActive) {
		return none("cleaning", "Reinigung aktiv — Kühlung gesperrt.");
	}

	const nowMin = input.now.getHours() * 60 + input.now.getMinutes();
	if (isHardOffTime(nowMin, unit.hardOffAt)) {
		if (switchIsOn(input.feedbackSwitchRaw)) {
			return {
				state: "running",
				demandStart: false,
				demandStop: true,
				modePurpose: "cooling",
				reasonDe: `Hard-Off ${unit.hardOffAt} — Abschaltung.`,
				demandUrgency01: 0,
			};
		}
		return none("idle", `Hard-Off ${unit.hardOffAt} — außerhalb Betrieb.`);
	}

	if (!isWithinClockWindow(nowMin, unit.activeFrom, unit.activeUntil)) {
		if (switchIsOn(input.feedbackSwitchRaw)) {
			return {
				state: "running",
				demandStart: false,
				demandStop: true,
				modePurpose: "cooling",
				reasonDe: `Außerhalb Zeitfenster ${unit.activeFrom}–${unit.activeUntil}.`,
				demandUrgency01: 0,
			};
		}
		return none("idle", `Außerhalb Zeitfenster ${unit.activeFrom}–${unit.activeUntil}.`);
	}

	const temp = input.roomTempC;
	if (temp === null) {
		// Already running without a readable temp: do not invent a stop, but also do not
		// pretend we evaluated off-temp (operator sees reason_de).
		return none("idle", "Raumtemperatur fehlt.");
	}

	const coolEnabled = acModeCommandEnabled(unit.modeWhenCooling);
	const dryEnabled =
		acModeCommandEnabled(unit.modeWhenDehumidify) && unit.maxHumidityPct !== null;
	const heatEnabled = acModeCommandEnabled(unit.modeWhenHeating);

	const humidity = input.roomHumidityPct;
	const humidityHigh =
		dryEnabled && humidity !== null && humidity >= unit.maxHumidityPct!;
	const humidityOffPct = dryEnabled
		? Math.max(0, unit.maxHumidityPct! - unit.humidityOffHysteresisPct)
		: null;
	const humidityLow =
		dryEnabled && humidity !== null && humidityOffPct !== null && humidity <= humidityOffPct;

	const tempHigh = temp >= unit.onTempC;
	const tempLow = temp <= unit.offTempC;
	const needCool = coolEnabled && tempHigh;
	const needDry = dryEnabled && humidityHigh;
	// Heating path reserved: only when mode string set (FSM demand not wired yet).
	void heatEnabled;

	/** Für die Hard-Off-Abwägung (compute_desired.ts) — 0, wenn aktuell kein Start-Bedarf besteht. */
	const demandUrgency01 = needCool
		? coolingDemandUrgency01(temp, unit.onTempC)
		: needDry
			? dehumidifyDemandUrgency01(humidity, unit.maxHumidityPct)
			: 0;

	if (!coolEnabled && !dryEnabled) {
		if (switchIsOn(input.feedbackSwitchRaw)) {
			return {
				state: "running",
				demandStart: false,
				demandStop: true,
				modePurpose: "cooling",
				reasonDe: "Kein Modus konfiguriert (cool/dry leer) — Abschalten.",
				demandUrgency01,
			};
		}
		return none("idle", "Kein Modus konfiguriert (cool/dry leer).");
	}

	// Cool has priority when temp is at/above on-temp; otherwise dry when humidity demands it.
	const modePurpose: AcUnitModePurpose = needCool ? "cooling" : needDry ? "dehumidify" : "cooling";

	if (switchIsOn(input.feedbackSwitchRaw)) {
		if (needCool || needDry) {
			const why = needCool
				? `Temp ${temp.toFixed(1)} °C ≥ ${unit.onTempC} °C — cool`
				: `Feuchte ${humidity!.toFixed(0)} % ≥ ${unit.maxHumidityPct} % — dry`;
			return {
				state: "running",
				demandStart: false,
				demandStop: false,
				modePurpose,
				reasonDe: `Läuft (${why}).`,
				demandUrgency01,
			};
		}
		/*
		 * Kühl-Hysterese VOR Feuchte-Aus: Sonst schaltet bei konfiguriertem Dry eine niedrige
		 * Raumfeuchte ab, sobald Temp unter die Ein-Schwelle fällt — obwohl die Kühl-Aus-Schwelle
		 * noch nicht erreicht ist → Takten + Reinigung, ohne bis offTempC durchzukühlen.
		 */
		if (coolEnabled) {
			if (tempLow) {
				return {
					state: "running",
					demandStart: false,
					demandStop: true,
					modePurpose: "cooling",
					reasonDe: `Temp ${temp.toFixed(1)} °C ≤ ${unit.offTempC} °C — Abschalten.`,
					demandUrgency01,
				};
			}
			return {
				state: "running",
				demandStart: false,
				demandStop: false,
				modePurpose: "cooling",
				reasonDe: `Temp ${temp.toFixed(1)} °C im Hysterese-Bereich — läuft weiter.`,
				demandUrgency01,
			};
		}
		if (humidityLow) {
			return {
				state: "running",
				demandStart: false,
				demandStop: true,
				modePurpose: "dehumidify",
				reasonDe: `Feuchte ${humidity!.toFixed(0)} % ≤ ${humidityOffPct} % — Entfeuchten fertig.`,
				demandUrgency01,
			};
		}
		// Dry-only: hold while humidity still above off-hysteresis.
		if (dryEnabled && !humidityLow) {
			return {
				state: "running",
				demandStart: false,
				demandStop: false,
				modePurpose: "dehumidify",
				reasonDe: `Feuchte im Hysterese-Bereich — dry läuft weiter.`,
				demandUrgency01,
			};
		}
		return {
			state: "running",
			demandStart: false,
			demandStop: true,
			modePurpose: "cooling",
			reasonDe: "Kein cool/dry-Bedarf — Abschalten.",
			demandUrgency01,
		};
	}

	// Switch off: start for cool and/or dry (dry may start even below cool off-temp).
	if (needCool || needDry) {
		const why = needCool
			? `Temp ${temp.toFixed(1)} °C ≥ ${unit.onTempC} °C — cool`
			: `Feuchte ${humidity!.toFixed(0)} % ≥ ${unit.maxHumidityPct} % — dry`;
		return {
			state: "idle",
			demandStart: true,
			demandStop: false,
			modePurpose,
			reasonDe: `${why} — Einschalten.`,
			demandUrgency01,
		};
	}

	if (!coolEnabled && dryEnabled && !humidityHigh) {
		return none("idle", "Dry konfiguriert, Feuchte unter Schwellwert.");
	}

	return none("idle", `Temp ${temp.toFixed(1)} °C im Hysterese-Bereich.`);
}
