/**
 * B1: Realer PV-Überschuss als Material-Replan-Signal für Heizstab-NOW.
 * Kein simples „Batterie voll ⇒ sofort heizen“ — alle Gates müssen greifen.
 */

/** Überschuss muss so lange über der IH-Min-Stufe bleiben (Entprellung). */
export const LIVE_THERMAL_SURPLUS_STABLE_MS = 90_000;
/** Mindestabstand zwischen Surplus-Replans (zusätzlich zur Stabilitätsdauer). */
export const LIVE_THERMAL_SURPLUS_REPLAN_COOLDOWN_MS = 180_000;
/** SOC ab dem Batterie als „nahe voll / keine sinnvolle Aufnahme“ gilt. */
export const LIVE_THERMAL_BATTERY_NEAR_FULL_SOC_PCT = 95;

export type LiveThermalSurplusReplanInput = {
	nowMs: number;
	/** Realer Operator-Überschuss (PV − Hauslast), W. */
	liveSurplusW: number | null;
	ihMinPowerW: number | null;
	thermalHeadroomKwh: number | null;
	/** Aktuelle publizierte IH-Allocation im NOW-Slot (W). */
	currentIhAllocatedW: number | null;
	batterySocPct: number | null;
	batteryMaxSocPct: number | null;
	/** Battery charge still meaningfully wanted (kWh); 0/null = keine Aufnahme nötig. */
	batteryRequiredChargeKwh: number | null;
	ihLiveWriteAllowed: boolean;
	ihGovernanceEnabled: boolean;
	/** Runtime würde wegen Hysterese/Safety jetzt nicht schreiben. */
	ihRuntimeWriteBlocked: boolean;
	/**
	 * Leistung (W) höher priorisierter LIVE-Bedarfe, die den Überschuss jetzt brauchen
	 * (z. B. Wallbox LIVE+verbunden mit Restbedarf, Klima LIVE mandatory aktiv).
	 * Dryrun-Add-ons zählen hier nicht.
	 */
	higherPriorityLiveDemandW: number;
	/** Interne Entprellung: seit wann Surplus die IH-Min-Stufe dauerhaft deckt. */
	surplusQualifySinceMs: number | null;
	lastThermalSurplusReplanAtMs: number | null;
};

export type LiveThermalSurplusReplanResult = {
	shouldReplan: boolean;
	preferImmersionNow: boolean;
	/** Aktualisierter Qualify-Timestamp für den nächsten Tick. */
	nextSurplusQualifySinceMs: number | null;
	reasonDe: string;
	blockReasonDe: string | null;
};

function batteryNearFullOrNoUptake(input: LiveThermalSurplusReplanInput): boolean {
	const soc = input.batterySocPct;
	if (soc === null || !Number.isFinite(soc)) return false;
	const maxSoc = input.batteryMaxSocPct;
	if (maxSoc !== null && Number.isFinite(maxSoc) && soc + 0.5 >= maxSoc) return true;
	if (soc >= LIVE_THERMAL_BATTERY_NEAR_FULL_SOC_PCT) return true;
	const need = input.batteryRequiredChargeKwh;
	if ((need === null || !(need > 0.15)) && soc >= 90) return true;
	return false;
}

/**
 * Rein: bewertet einen Tick. Debounce-State wird als nextSurplusQualifySinceMs zurückgegeben.
 */
export function evaluateLiveThermalSurplusReplan(
	input: LiveThermalSurplusReplanInput,
): LiveThermalSurplusReplanResult {
	const ihMin = input.ihMinPowerW;
	const surplus = input.liveSurplusW;
	const headroom = input.thermalHeadroomKwh;
	const currentIh = input.currentIhAllocatedW ?? 0;

	const fail = (
		blockReasonDe: string,
		nextSurplusQualifySinceMs: number | null,
	): LiveThermalSurplusReplanResult => ({
		shouldReplan: false,
		preferImmersionNow: false,
		nextSurplusQualifySinceMs,
		reasonDe: "",
		blockReasonDe,
	});

	if (!input.ihGovernanceEnabled || !input.ihLiveWriteAllowed) {
		return fail("IH nicht LIVE/Governance", null);
	}
	if (input.ihRuntimeWriteBlocked) {
		return fail("IH Runtime Hysterese/Safety sperrt Writes", null);
	}
	if (ihMin === null || !(ihMin > 0)) {
		return fail("IH Min-Stufe unbekannt", null);
	}
	if (headroom === null || !(headroom > 0.05)) {
		return fail("kein thermischer Headroom", null);
	}
	if (currentIh + 1 >= ihMin) {
		return fail("IH-Slot bereits allokiert", input.surplusQualifySinceMs);
	}
	if (!batteryNearFullOrNoUptake(input)) {
		return fail("Batterie kann noch sinnvoll laden", null);
	}
	if (surplus === null || !Number.isFinite(surplus)) {
		return fail("Live-Überschuss fehlt", null);
	}

	const reserved = Math.max(0, input.higherPriorityLiveDemandW);
	const available = surplus - reserved;
	if (available + 1 < ihMin) {
		return fail(
			reserved > 0
				? `Überschuss nach LIVE-Vorrang (${Math.round(reserved)} W) reicht nicht für IH`
				: "Überschuss unter IH-Min-Stufe",
			null,
		);
	}

	const qualifySince =
		input.surplusQualifySinceMs !== null && Number.isFinite(input.surplusQualifySinceMs)
			? input.surplusQualifySinceMs
			: input.nowMs;
	const stableMs = input.nowMs - qualifySince;
	if (stableMs < LIVE_THERMAL_SURPLUS_STABLE_MS) {
		return {
			shouldReplan: false,
			preferImmersionNow: false,
			nextSurplusQualifySinceMs: qualifySince,
			reasonDe: "",
			blockReasonDe: `Überschuss noch nicht stabil (${Math.round(stableMs / 1000)}s/${LIVE_THERMAL_SURPLUS_STABLE_MS / 1000}s)`,
		};
	}

	const last = input.lastThermalSurplusReplanAtMs;
	if (last !== null && input.nowMs - last < LIVE_THERMAL_SURPLUS_REPLAN_COOLDOWN_MS) {
		return {
			shouldReplan: false,
			preferImmersionNow: true, // Score darf NOW trotzdem bevorzugen, falls Replan kürzlich lief
			nextSurplusQualifySinceMs: qualifySince,
			reasonDe: "",
			blockReasonDe: "Surplus-Replan Cooldown aktiv",
		};
	}

	return {
		shouldReplan: true,
		preferImmersionNow: true,
		nextSurplusQualifySinceMs: qualifySince,
		reasonDe: `Live-Überschuss ${Math.round(available)} W ≥ IH ${Math.round(ihMin)} W, Batterie nahe voll, Headroom ${headroom.toFixed(2)} kWh — NOW bevorzugen`,
		blockReasonDe: null,
	};
}
