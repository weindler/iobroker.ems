import type {
	BatteryConsumerAccess,
	BatteryConsumerId,
	ResolveBatteryConsumerAccessInput,
} from "./types";
import type { BatteryConsumersConfig } from "./types";
import { batteryConsumerRule } from "./config";

/**
 * Deterministic gate: may this consumer draw house-battery energy right now?
 * Operator + Allocation must call this — never a silent addon-side write around EVCC.
 */
export function resolveBatteryConsumerAccess(input: ResolveBatteryConsumerAccessInput): BatteryConsumerAccess {
	const { consumerId, rule, batteryHoldActive, socPct, criticalNow } = input;
	const base = {
		consumerId,
		mayUseBattery: rule.mayUseBattery,
		onlyWhenCritical: rule.onlyWhenCritical,
		criticalNow,
		minSocPct: rule.minSocPct,
		socPct,
		batteryHoldActive,
	};

	if (!rule.mayUseBattery) {
		return { ...base, allowed: false, reasonDe: "Policy: Batterie für diesen Verbraucher nicht erlaubt." };
	}
	if (batteryHoldActive) {
		return {
			...base,
			allowed: false,
			reasonDe: "Batterie-Hold aktiv (EVCC/Intent) — kein Verbraucher-Zugriff.",
		};
	}
	if (rule.minSocPct !== null) {
		if (socPct === null) {
			return { ...base, allowed: false, reasonDe: "SOC unbekannt — Batteriezugriff gesperrt." };
		}
		if (socPct <= rule.minSocPct) {
			return {
				...base,
				allowed: false,
				reasonDe: `SOC ${socPct.toFixed(0)} % ≤ Boden ${rule.minSocPct} % — Batteriezugriff gesperrt.`,
			};
		}
	}
	if (rule.onlyWhenCritical) {
		if (criticalNow === null) {
			return {
				...base,
				allowed: false,
				reasonDe: "Nur-kritisch: kritischer Zustand unbekannt — kein Batteriezugriff.",
			};
		}
		if (!criticalNow) {
			return {
				...base,
				allowed: false,
				reasonDe: "Nur-kritisch: Zustand nicht kritisch — nur PV/Policy-Netz.",
			};
		}
	}

	return {
		...base,
		allowed: true,
		reasonDe: rule.onlyWhenCritical
			? "Batterie für kritischen Verbraucherbedarf freigegeben."
			: "Batterie für Verbraucher freigegeben.",
	};
}

export function resolveAllBatteryConsumerAccess(input: {
	config: BatteryConsumersConfig;
	batteryHoldActive: boolean;
	socPct: number | null;
	criticalByConsumer: Partial<Record<BatteryConsumerId, boolean | null>>;
}): Record<BatteryConsumerId, BatteryConsumerAccess> {
	const ids: BatteryConsumerId[] = ["immersion_heater", "air_conditioning", "wallbox"];
	const out = {} as Record<BatteryConsumerId, BatteryConsumerAccess>;
	for (const id of ids) {
		out[id] = resolveBatteryConsumerAccess({
			consumerId: id,
			rule: batteryConsumerRule(input.config, id),
			batteryHoldActive: input.batteryHoldActive,
			socPct: input.socPct,
			criticalNow: input.criticalByConsumer[id] ?? null,
		});
	}
	return out;
}

/** Immersion critical: buffer at or below planningMin + margin. */
export function immersionCriticalNow(
	bufferTempC: number | null,
	planningMinTempC: number,
	criticalMarginK: number | null,
): boolean | null {
	if (bufferTempC === null) return null;
	const margin = criticalMarginK ?? 0;
	return bufferTempC <= planningMinTempC + margin;
}
