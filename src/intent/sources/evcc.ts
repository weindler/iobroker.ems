import type { IntentField } from "../core/types";
import type { StateHost } from "../../ems_light/state_util";
import {
	immediateFromBool,
	normalizeDeadline,
	normalizeEvccMode,
	normalizeTargetSoc,
} from "../wallbox/normalize";
import type { EvccIntentSnapshot } from "../wallbox/types";
import type { IntentEvccConfig } from "../config";
import { configuredEvccStateIds, isValidExternalStateId } from "../config";

export type EvccReadHost = StateHost & {
	getForeignStateAsync?: (objectId: string) => Promise<ioBroker.State | null | undefined>;
};

async function readForeign(host: EvccReadHost, objectId: string): Promise<{ val: unknown; ts?: number } | null> {
	if (!objectId || !isValidExternalStateId(objectId)) {
		return null;
	}
	if (host.getForeignStateAsync) {
		const st = await host.getForeignStateAsync(objectId);
		if (!st) return null;
		return { val: st.val, ts: st.ts };
	}
	// Fallback: only works if id is relative to adapter namespace (should not happen for EVCC)
	const st = await host.getStateAsync(objectId);
	if (!st) return null;
	return { val: st.val, ts: st.ts };
}

function makeField<T>(
	value: T | null,
	status: import("../core/types").IntentFieldStatus,
	observedAt: string,
	raw: unknown,
	changedAt?: string,
): IntentField<T> {
	return {
		value,
		status,
		origin: {
			source: "evcc",
			owner: "evcc",
			change_kind: "unknown",
		},
		observed_at: observedAt,
		changed_at: changedAt,
		raw_value: raw,
	};
}

export async function readEvccIntentSnapshot(
	host: EvccReadHost,
	cfg: IntentEvccConfig,
	timezone: string,
	now: Date,
): Promise<EvccIntentSnapshot> {
	const observedAt = now.toISOString();
	const ids = configuredEvccStateIds(cfg);

	if (ids.length === 0) {
		return {
			observed_at: observedAt,
			charge_strategy: makeField<import("../core/types").WallboxChargeStrategy>(null, "missing", observedAt, null),
			target_soc_pct: makeField<number>(null, "missing", observedAt, null),
			deadline: makeField<import("../core/types").WallboxDeadlineValue>(null, "missing", observedAt, null),
			status: "unconfigured",
		};
	}

	let lastError: string | undefined;
	let sourceTs: string | undefined;

	try {
		if (cfg.sourceTimestampStateId) {
			const tsSt = await readForeign(host, cfg.sourceTimestampStateId);
			if (tsSt?.val != null) {
				const n = typeof tsSt.val === "number" ? tsSt.val : Date.parse(String(tsSt.val));
				if (Number.isFinite(n)) {
					sourceTs = new Date(n > 1e12 ? n : n * 1000).toISOString();
				}
			}
		}

		let modeRaw: unknown = null;
		let socRaw: unknown = null;
		let deadlineRaw: unknown = null;
		let immediateRaw: unknown = null;

		if (cfg.modeStateId) {
			const st = await readForeign(host, cfg.modeStateId);
			modeRaw = st?.val ?? null;
		}
		if (cfg.targetSocStateId) {
			const st = await readForeign(host, cfg.targetSocStateId);
			socRaw = st?.val ?? null;
		}
		if (cfg.deadlineStateId) {
			const st = await readForeign(host, cfg.deadlineStateId);
			deadlineRaw = st?.val ?? null;
		}
		if (cfg.immediateStateId) {
			const st = await readForeign(host, cfg.immediateStateId);
			immediateRaw = st?.val ?? null;
		}

		const modeNorm = normalizeEvccMode(modeRaw);
		let strategy = modeNorm.strategy;
		let strategyStatus = modeNorm.status;
		let strategyRaw: unknown = modeNorm.raw;

		const imm = immediateFromBool(immediateRaw);
		if (imm === "immediate" && strategy !== "immediate") {
			strategy = "immediate";
			strategyStatus = "valid";
			strategyRaw = immediateRaw ?? modeRaw;
		}

		const socNorm = normalizeTargetSoc(socRaw);
		const deadlineNorm = normalizeDeadline(deadlineRaw, timezone, now);

		const changedAt = sourceTs;

		const charge_strategy = makeField(strategy, strategyStatus, observedAt, strategyRaw, changedAt);
		const target_soc_pct = makeField(socNorm.value, socNorm.status, observedAt, socNorm.raw, changedAt);
		const deadline = makeField(deadlineNorm.value, deadlineNorm.status, observedAt, deadlineNorm.raw, changedAt);

		const hasAny =
			charge_strategy.status !== "missing" ||
			target_soc_pct.status !== "missing" ||
			deadline.status !== "missing";

		return {
			observed_at: observedAt,
			charge_strategy,
			target_soc_pct,
			deadline,
			status: hasAny ? "ok" : "partial",
			last_error: lastError,
		};
	} catch (e) {
		lastError = String(e);
		return {
			observed_at: observedAt,
			charge_strategy: makeField<import("../core/types").WallboxChargeStrategy>(null, "missing", observedAt, null),
			target_soc_pct: makeField<number>(null, "missing", observedAt, null),
			deadline: makeField<import("../core/types").WallboxDeadlineValue>(null, "missing", observedAt, null),
			status: "error",
			last_error: lastError,
		};
	}
}
