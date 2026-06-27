import type { IntentField } from "../core/types";
import type { IntentAdminConfig } from "../config";
import type { AdminIntentSnapshot } from "../wallbox/types";

function adminField<T>(
	value: T | null,
	status: import("../core/types").IntentFieldStatus,
	observedAt: string,
): IntentField<T> {
	return {
		value,
		status,
		origin: {
			source: "admin",
			owner: "admin_config",
			change_kind: "configured",
		},
		observed_at: observedAt,
	};
}

export function buildAdminIntentSnapshot(cfg: IntentAdminConfig, now: Date): AdminIntentSnapshot {
	const observedAt = now.toISOString();
	return {
		observed_at: observedAt,
		charge_strategy: cfg.defaultChargeStrategy
			? adminField(cfg.defaultChargeStrategy, "valid", observedAt)
			: null,
		target_soc_pct:
			cfg.defaultTargetSocPct !== null
				? adminField(cfg.defaultTargetSocPct, "valid", observedAt)
				: null,
		timezone: cfg.timezone,
	};
}
