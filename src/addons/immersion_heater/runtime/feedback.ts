import type { PowerVerificationStatus } from "./types";

/**
 * Normalisiert einen Stage-Feedback-Wert auf aktiv/inaktiv.
 *
 * - boolean → direkt
 * - number  → > 0 aktiv, 0 inaktiv
 * - string  → "1"/"true"/"on"/"yes"/"ein" aktiv, "0"/"false"/"off"/"no"/"aus" inaktiv,
 *   sonst numerisch geparst (> 0 aktiv)
 *
 * Rückgabe `null` bedeutet „unbekannt/nicht lesbar" (z. B. State nie gesetzt) und darf
 * nicht als „inaktiv" fehlinterpretiert werden, wenn die Quelle real einen Wert liefert.
 */
export function normalizeFeedbackActive(val: unknown): boolean | null {
	if (val === null || val === undefined) return null;
	if (typeof val === "boolean") return val;
	if (typeof val === "number") return Number.isFinite(val) ? val > 0 : null;
	if (typeof val === "string") {
		const s = val.trim().toLowerCase();
		if (s === "") return null;
		if (["1", "true", "on", "yes", "ein"].includes(s)) return true;
		if (["0", "false", "off", "no", "aus"].includes(s)) return false;
		const n = parseFloat(s.replace(",", "."));
		return Number.isFinite(n) ? n > 0 : null;
	}
	return null;
}

export interface StageFeedbackReading {
	index: number;
	active: boolean | null;
}

/**
 * Höchste aktiv zurückgemeldete Stufe (0 = keine aktiv). Mehrere aktive Stufen →
 * höchster Index gewinnt (defensive Annahme bei exklusiven Stufen).
 */
export function feedbackStageFromReadings(readings: StageFeedbackReading[]): number {
	let stage = 0;
	for (const r of readings) {
		if (r.active === true && r.index > stage) {
			stage = r.index;
		}
	}
	return stage;
}

/**
 * Erkennt Fremdsteuerung: EMS befiehlt AUS (Stufe 0), aber Gerät meldet/zieht Leistung.
 * - feedback aktiv → `external_on` (Rückmeldung zeigt eindeutig fremden Betrieb)
 * - nur Leistung, keine Feedback-Bestätigung → `unexpected_external_on`
 * Gibt `null` zurück, wenn EMS selbst eingeschaltet hat (kein Fremdbetrieb).
 */
export function externalOnStatus(params: {
	commandedStage: number;
	feedbackActive: boolean;
	powerActive: boolean;
}): PowerVerificationStatus | null {
	if (params.commandedStage > 0) return null;
	if (params.feedbackActive) return "external_on";
	if (params.powerActive) return "unexpected_external_on";
	return null;
}

/** Klima-/Ownership-Block: Manual-Override zeitbegrenzt, bevor EMS erneut selbst greift. */
export const IMMERSION_MANUAL_OVERRIDE_DURATION_MS_DEFAULT = 30 * 60_000;
/** Kein Mismatch-Alarm kurz nach einem eigenen EMS-Stufenwechsel (Relais-/Feedback-Verzögerung). */
export const IMMERSION_OWNERSHIP_SETTLE_MS = 2 * 60_000;

export type ImmersionMismatchKind = "manual_on" | "manual_off" | "";

/**
 * Symmetrische Erweiterung von `externalOnStatus` für den Ownership-Block: erkennt sowohl
 * „EMS wollte AUS, Gerät läuft" (manual_on) als auch „EMS wollte AN, Gerät ist aus" (manual_off).
 * Nutzt bewusst das Feedback/Stage des VORIGEN Takts (vor dem heutigen Write), damit kein
 * eigener, noch nicht bestätigter EMS-Write fälschlich als Fremdeingriff gilt.
 */
export function detectImmersionManualMismatch(params: {
	prevCommandedStage: number;
	prevFeedbackActive: boolean | null;
}): ImmersionMismatchKind {
	if (params.prevFeedbackActive === null) return "";
	const emsWantedOn = params.prevCommandedStage > 0;
	if (!emsWantedOn && params.prevFeedbackActive) return "manual_on";
	if (emsWantedOn && !params.prevFeedbackActive) return "manual_off";
	return "";
}
