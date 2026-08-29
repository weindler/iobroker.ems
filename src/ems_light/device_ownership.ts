/**
 * Generisches Ownership-/Manual-Override-Modell (Klima-/Ownership-Block).
 *
 * Vorlage (wiederverwendet, nicht neu erfunden): `addons/battery/runtime/ownership.ts`
 * (`OwnershipState`/`isForeignManualControl`) und die Wallbox-EVCC-Authority-Hysterese
 * (`addons/wallbox/ev_foundation/execution/types.ts`, `EV_AUTHORITY_HOLD_MS`/`_CONFIRM_MS`).
 *
 * Zustände: „ems“ (EMS steuert), „user“ (erkannter manueller Eingriff — EMS pausiert
 * zeitbegrenzt) und „external“ (Typ-Wert für künftige, technisch unterscheidbare Fremdsysteme;
 * aus einem reinen State-Vergleich ist „Nutzer“ vs. „fremdes System“ nicht unterscheidbar —
 * beide lösen denselben Override aus, siehe `evaluateDeviceOwnership`).
 *
 * Kein neues Governance-Framework: reine, ioBroker-freie Funktionen, ein Zeit-begrenzter
 * Override pro Gerät/Unit, ausgelöst durch einen erkannten Widerspruch EMS-Wunsch vs. Ist.
 */

export type DeviceOwner = "ems" | "user" | "external";

export type DeviceOwnershipState = {
	owner: DeviceOwner;
	/** ISO — bis wann der Override gilt; null = kein aktiver Override. */
	overrideUntilIso: string | null;
	/** Wann der aktuelle Override zuletzt (neu) ausgelöst wurde — für Diagnose/Replan. */
	triggeredAtIso: string | null;
	reasonDe: string;
};

export function emptyDeviceOwnershipState(): DeviceOwnershipState {
	return { owner: "ems", overrideUntilIso: null, triggeredAtIso: null, reasonDe: "" };
}

export type DetectManualOverrideInput = {
	nowMs: number;
	/**
	 * true, wenn der beobachtete Ist-Zustand vom EMS-Wunsch abweicht und das nicht durch einen
	 * soeben erst ausgeführten eigenen EMS-Write erklärbar ist (Feedback-Verzögerung).
	 */
	mismatchDetected: boolean;
	/** Nur Diagnose/Reason-Text — keine Steuerwirkung. */
	mismatchKind?: "manual_on" | "manual_off" | "";
	previous: DeviceOwnershipState;
	overrideDurationMs: number;
	/** Safety/kritischer Zustand beendet einen Override sofort — EMS behält/übernimmt Kontrolle. */
	safetyOverride: boolean;
};

export function evaluateDeviceOwnership(input: DetectManualOverrideInput): DeviceOwnershipState {
	const nowIso = new Date(input.nowMs).toISOString();

	if (input.safetyOverride) {
		return {
			owner: "ems",
			overrideUntilIso: null,
			triggeredAtIso: input.previous.triggeredAtIso,
			reasonDe: "Safety/kritischer Zustand — Manual-Override übersteuert, EMS behält Kontrolle.",
		};
	}

	const prevUntilMs = input.previous.overrideUntilIso ? Date.parse(input.previous.overrideUntilIso) : NaN;
	const prevActive = Number.isFinite(prevUntilMs) && prevUntilMs > input.nowMs;

	if (input.mismatchDetected) {
		const untilMs = input.nowMs + Math.max(0, input.overrideDurationMs);
		const untilIso = new Date(untilMs).toISOString();
		const kindDe =
			input.mismatchKind === "manual_on"
				? "Manuelles Einschalten"
				: input.mismatchKind === "manual_off"
					? "Manuelles Ausschalten"
					: "Manueller Eingriff";
		return {
			owner: "user",
			overrideUntilIso: untilIso,
			triggeredAtIso: prevActive ? input.previous.triggeredAtIso : nowIso,
			reasonDe: `${kindDe} erkannt — EMS-Steuerung pausiert bis ${untilIso}.`,
		};
	}

	if (prevActive) {
		// Override läuft weiter — kein erneuter Mismatch nötig, um ihn zu HALTEN.
		return input.previous;
	}

	return emptyDeviceOwnershipState();
}

export function isOwnershipOverrideActive(state: DeviceOwnershipState, nowMs: number): boolean {
	if (state.overrideUntilIso === null) return false;
	const untilMs = Date.parse(state.overrideUntilIso);
	return Number.isFinite(untilMs) && untilMs > nowMs;
}
