import { globalPolicyConfigFromAdapter } from "../../policy/global/config";
import type { PolicySnapshot } from "../../policy/core/types";
import { priceForecastConfigFromAdapter } from "../../learning/price_forecast/config";
import {
	parseTibberPriceJsonTo15MinSlots,
	type Price15MinSlot,
} from "../../learning/price_forecast/tibber_parse";
import { asNum } from "../../ems_light/state_util";
import type { StateHost } from "../../ems_light/state_util";
import type { GridSupplyBuildInput } from "./grid";

export type GridSupplyReadHost = StateHost & {
	config?: unknown;
	log?: { warn?: (msg: string) => void };
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
};

async function readVal(host: GridSupplyReadHost, stateId: string): Promise<unknown> {
	if (!stateId.trim()) return null;
	const tryRead = async (
		fn?: (id: string) => Promise<ioBroker.State | null | undefined>,
	): Promise<unknown> => {
		if (!fn) return null;
		try {
			const st = await fn.call(host, stateId);
			return st?.val ?? null;
		} catch {
			return null;
		}
	};
	const foreign = await tryRead(host.getForeignStateAsync);
	if (foreign !== null && foreign !== undefined) return foreign;
	return tryRead(host.getStateAsync);
}

async function readNum(host: GridSupplyReadHost, relId: string): Promise<number | null> {
	try {
		const st = await host.getStateAsync(relId);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

async function readStr(host: GridSupplyReadHost, relId: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(relId);
		if (st?.val == null || st.val === "") return null;
		return String(st.val);
	} catch {
		return null;
	}
}

function policyBoolValue(snapshot: PolicySnapshot | null, section: "economics", key: string): boolean | null {
	const entry = snapshot?.[section]?.[key];
	if (!entry || entry.value === null || entry.value === undefined) return null;
	if (typeof entry.value === "boolean") return entry.value;
	return null;
}

function policyNumberValue(snapshot: PolicySnapshot | null, section: "limits", key: string): number | null {
	const entry = snapshot?.[section]?.[key];
	if (!entry || entry.value === null || entry.value === undefined) return null;
	const n = typeof entry.value === "number" ? entry.value : parseFloat(String(entry.value));
	return Number.isFinite(n) ? n : null;
}

async function readEffectivePolicySnapshot(host: GridSupplyReadHost): Promise<PolicySnapshot | null> {
	const raw = await readStr(host, "policy.global.effective_json");
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as PolicySnapshot;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

/** Liest Tibber Today/Tomorrow-JSON und liefert sortierte 15-min-Preisslots ab now. */
export async function readDynamicTariffPrice15MinSlots(
	host: GridSupplyReadHost,
	now: Date,
): Promise<Price15MinSlot[]> {
	const cfg = priceForecastConfigFromAdapter(host.config);
	if (!cfg.todayJsonStateId && !cfg.tomorrowJsonStateId) {
		return [];
	}

	const minStartMs = now.getTime();
	const byStart = new Map<number, Price15MinSlot>();

	for (const stateId of [cfg.todayJsonStateId, cfg.tomorrowJsonStateId]) {
		if (!stateId) continue;
		const raw = await readVal(host, stateId);
		for (const slot of parseTibberPriceJsonTo15MinSlots(raw, { minStartMs })) {
			byStart.set(slot.slotStartMs, slot);
		}
	}

	return [...byStart.values()].sort((a, b) => a.slotStartMs - b.slotStartMs);
}

export async function collectGridSupplyBuildInput(
	host: GridSupplyReadHost,
	now: Date,
): Promise<GridSupplyBuildInput> {
	const adminPolicy = globalPolicyConfigFromAdapter(host.config);
	const effectivePolicy = await readEffectivePolicySnapshot(host);

	const policyGridImportAllowed =
		policyBoolValue(effectivePolicy, "economics", "gridImportAllowed") ?? adminPolicy.gridImportAllowed;

	const configuredMaxGridImportW =
		policyNumberValue(effectivePolicy, "limits", "maxGridImportW") ?? adminPolicy.maxGridImportW;

	const configuredHouseFuseLimitW =
		policyNumberValue(effectivePolicy, "limits", "houseFuseLimitW") ?? adminPolicy.houseFuseLimitW;

	const [globalMode, currentPriceCtPerKwh, fixedPriceCtPerKwh, dynamicSlots] = await Promise.all([
		readStr(host, "global_modes.active"),
		readNum(host, "live.price.now_ct_per_kwh"),
		readNum(host, "economics.config.fixed_price_ct_per_kwh"),
		readDynamicTariffPrice15MinSlots(host, now),
	]);

	return {
		now,
		globalMode,
		policyGridImportAllowed,
		configuredMaxGridImportW,
		configuredHouseFuseLimitW,
		currentPriceCtPerKwh,
		fixedPriceCtPerKwh,
		dynamicSlots,
	};
}
