/**
 * Datenquellen für Tages-Telemetrie — bestehende EMS-Mirror-/Runtime-States.
 * Keine neuen Mappings; fehlende Werte bleiben null.
 */

import { BAT } from "../../addons/battery/ensure_states";
import { IMMERSION_RUNTIME_STATES } from "../../addons/immersion_heater/runtime/types";
/** Live-PV (gepflegt vom Live-Cache) — nicht grid_balance.pv_power_w (ungeschrieben). */
const LIVE_PV_POWER_W = "live.battery.pv_ac_power_w";
const LIVE_PV_POWER_W_MIRROR = "live.pv.power_w";
import {
	AC_RUNTIME_SUMMARY_STATES,
	acUnitRuntimeStates,
} from "../../addons/air_conditioning/runtime/ensure_states";
import { AC_UNIT_COUNT } from "../../addons/air_conditioning/constants";
import { acUnitConfigFromAdapter, availableAcModePurposes } from "../../addons/air_conditioning/config";
import { weatherConfigFromAdapter } from "../weather/config";
import { WALLBOX_EV_FOUNDATION_STATES } from "../../addons/wallbox/ev_foundation/ensure_states";
import { MEASURED_CONSUMERS_AGGREGATE_STATES } from "../../addons/measured_consumers/runtime/state_ids";
import { asBool, asNum } from "../../ems_light/state_util";
import { resolveHouseLoadPowerStateId } from "../house_load/mapping";
import { statisticsConfigFromAdapter } from "../../statistics/config";
import { houseLoadConfigFromAdapter } from "../house_load/config";
import { DEFAULT_PRICE_STATE_ID } from "../price_learning/constants";
import { GRID_SUPPLY_STATE_IDS } from "../../operator/supply/grid_states";
import { CONTRIBUTION_IDS } from "../../operator/contribution_ids";
import {
	climateOverrideActive,
	climateSlotDemandUrgency01,
	normalizeClimateModePurpose,
} from "./climate_unit_slots";
import type { ClimateModePurpose } from "./types";

export type TelemetrySampleHost = {
	config?: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
};

export type LiveTelemetrySample = {
	tsMs: number;
	pvPowerW: number | null;
	houseTotalPowerW: number | null;
	/** Flex-Lasten (W) — für spätere Baseline-Zerlegung, nicht von house abziehen in Persistenz. */
	immersionPowerW: number | null;
	wallboxChargePowerW: number | null;
	batteryChargePowerW: number | null;
	batteryDischargePowerW: number | null;
	/** EMS-Netzausgleichs-Entladeleistung ≥ 0 W; null = missing. */
	gridBalanceDischargePowerW: number | null;
	/** Angefragte GB-Leistung; null = missing. */
	gridBalanceRequestedPowerW: number | null;
	gridBalanceActive: boolean | null;
	/** Setpoint-Owner (grid_charge / grid_balance / …). */
	batterySetpointOwner: string | null;
	climateSystemPowerW: number | null;
	climateSharedPowerUsed: boolean | null;
	climateUnitActive: boolean[];
	climateMode: string | null;
	/** Bekannte sharedPowerGroupId aktiver Units; null = unknown/nicht vertrauenswürdig. */
	climateSharedPowerGroupId: string | null;
	gridImportEnergyKwh: number | null;
	gridExportEnergyKwh: number | null;
	gridImportPowerW: number | null;
	priceCtPerKwh: number | null;
	batterySocPct: number | null;
	evChargePowerW: number | null;
	evSocPct: number | null;
	evConnected: boolean | null;
	immersionRuntimeOn: boolean | null;
	boilerTempC: number | null;
	otherMeasuredConsumersPowerW: number | null;
	ownershipActive: boolean | null;
	/**
	 * Additiv (Block A): Live-Mirror bestehender Immersion-Runtime-States — kein Recompute,
	 * keine neue Logik. `null` wenn zu diesem Zeitpunkt nicht verfügbar.
	 */
	immersionDecisionSource: string | null;
	immersionResolvedMode: string | null;
	immersionHygieneStatusDe: string | null;
	immersionOwnershipOwner: string | null;
	/** Außen-Ist °C — gemapptes Weather-Actual, null wenn nicht gemappt/verfügbar. */
	outdoorTempC: number | null;
	/** Bewölkung-Ist %, sofern gemappt. */
	cloudPct: number | null;
	/** Pro-Unit Climate-Live-Snapshot (nur Units mit Config/Telemetrie). */
	climateUnits: ClimateUnitLiveSample[];
};

export type ClimateUnitLiveSample = {
	unitIndex: number;
	enabled: boolean;
	roomTempC: number | null;
	roomHumidityPct: number | null;
	targetTempC: number | null;
	coolingOnTempC: number | null;
	coolingOffTempC: number | null;
	heatingSetpointC: number | null;
	maxHumidityPct: number | null;
	modesAvailable: string[];
	running: boolean | null;
	modePurpose: ClimateModePurpose;
	hardOffAt: string | null;
	demandUrgency01: number | null;
	ownershipOwner: string | null;
	overrideActive: boolean | null;
	sharedPowerGroupId: string | null;
};

async function readNum(host: TelemetrySampleHost, id: string): Promise<number | null> {
	if (!id) return null;
	let st = await host.getStateAsync(id);
	if ((st == null || st.val == null) && host.getForeignStateAsync) {
		st = await host.getForeignStateAsync(id);
	}
	return asNum(st?.val);
}

async function readBool(host: TelemetrySampleHost, id: string): Promise<boolean | null> {
	if (!id) return null;
	const st = await host.getStateAsync(id);
	return asBool(st?.val);
}

async function readStr(host: TelemetrySampleHost, id: string): Promise<string | null> {
	if (!id) return null;
	const st = await host.getStateAsync(id);
	if (st?.val == null) return null;
	const s = String(st.val).trim();
	return s || null;
}

/**
 * Realer Tarifpreis für den aktuellen Zeitpunkt — unabhängig vom Unified Day Plan.
 *
 * Primär: Grid-Supply-Slots (produktive Tarif-/Tibber-Pipeline).
 * Fallback: live.price.now_ct_per_kwh, dann grid.current_price_ct_per_kwh.
 * Niemals planner.intent.daily_plan.plan_json.
 */
export async function resolveTelemetryPriceCtPerKwh(
	host: TelemetrySampleHost,
	nowMs: number,
): Promise<number | null> {
	const slotsRaw = await readStr(host, GRID_SUPPLY_STATE_IDS.slotsJson);
	if (slotsRaw) {
		try {
			const slots = JSON.parse(slotsRaw) as Array<{
				startIso?: string;
				endIso?: string;
				priceCtPerKwh?: number | null;
			}>;
			if (Array.isArray(slots)) {
				for (const s of slots) {
					const a = s.startIso ? Date.parse(s.startIso) : NaN;
					const b = s.endIso ? Date.parse(s.endIso) : NaN;
					if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
					if (nowMs >= a && nowMs < b) {
						const ct = s.priceCtPerKwh;
						if (ct != null && Number.isFinite(ct)) return ct;
					}
				}
			}
		} catch {
			/* slots_json ungültig → Fallbacks */
		}
	}

	const live = await readNum(host, DEFAULT_PRICE_STATE_ID);
	if (live != null && Number.isFinite(live)) return live;

	const gridNow = await readNum(host, GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh);
	if (gridNow != null && Number.isFinite(gridNow)) return gridNow;

	return null;
}

/**
 * Shared-Power-Gruppe aus Admin-Config der aktiven Units.
 * null wenn keine Unit aktiv, Gruppe unbekannt oder mehrere unterschiedliche Gruppen.
 * Niemals "default" erfinden.
 */
export function resolveActiveSharedPowerGroupId(
	active: boolean[],
	config: unknown,
	plannerGroupByConsumerId?: Map<string, string> | null,
): { groupId: string | null; rejectReason: string | null } {
	const groups = new Set<string>();
	let anyActive = false;
	for (let i = 0; i < active.length; i++) {
		if (!active[i]) continue;
		anyActive = true;
		const unitIndex = i + 1;
		const fromConfig = acUnitConfigFromAdapter(config, unitIndex).sharedPowerGroupId?.trim() || null;
		const consumerId = CONTRIBUTION_IDS.AC_UNIT(unitIndex);
		const fromPlanner = plannerGroupByConsumerId?.get(consumerId)?.trim() || null;
		const g = fromConfig || fromPlanner || null;
		if (g) groups.add(g);
	}
	if (!anyActive) return { groupId: null, rejectReason: null };
	if (groups.size === 1) return { groupId: [...groups][0], rejectReason: null };
	if (groups.size > 1) {
		return { groupId: null, rejectReason: "shared_power_group_ambiguous" };
	}
	return { groupId: null, rejectReason: "shared_power_group_unknown" };
}

export async function readLiveTelemetrySample(
	host: TelemetrySampleHost,
	nowMs: number = Date.now(),
): Promise<LiveTelemetrySample> {
	const hlCfg = houseLoadConfigFromAdapter(host.config);
	const houseSrc = await resolveHouseLoadPowerStateId(host, hlCfg.powerStateId);
	const statsCfg = statisticsConfigFromAdapter(host.config);

	const climateUnitActive: boolean[] = [];
	let climateMode: string | null = null;
	const climateUnits: ClimateUnitLiveSample[] = [];
	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		const ids = acUnitRuntimeStates(i);
		const unitCfg = acUnitConfigFromAdapter(host.config, i);
		const running = await readBool(host, ids.running);
		const active = running === true;
		climateUnitActive.push(active);
		const purposeRaw = await readStr(host, ids.modePurpose);
		if (active && !climateMode) {
			climateMode = purposeRaw;
		}
		const roomTempC = await readNum(host, ids.roomTempC);
		const roomHumidityPct = await readNum(host, ids.roomHumidityPct);
		const include = unitCfg.enabled || active || roomTempC != null;
		if (!include) continue;
		const modePurpose = active ? normalizeClimateModePurpose(purposeRaw) : "off";
		const ownershipOwner = await readStr(host, ids.ownershipOwner);
		const overrideUntilIso = await readStr(host, ids.ownershipOverrideUntilIso);
		const overrideActive = climateOverrideActive(ownershipOwner, overrideUntilIso, nowMs);
		const targetTempC = await readNum(host, ids.setpointTempC);
		const modesAvailable = availableAcModePurposes(unitCfg);
		climateUnits.push({
			unitIndex: i,
			enabled: unitCfg.enabled,
			roomTempC,
			roomHumidityPct,
			targetTempC,
			coolingOnTempC: Number.isFinite(unitCfg.onTempC) ? unitCfg.onTempC : null,
			coolingOffTempC: Number.isFinite(unitCfg.offTempC) ? unitCfg.offTempC : null,
			heatingSetpointC: unitCfg.heatSetpointC,
			maxHumidityPct: unitCfg.maxHumidityPct,
			modesAvailable,
			running,
			modePurpose,
			hardOffAt: unitCfg.hardOffAt?.trim() || null,
			demandUrgency01: climateSlotDemandUrgency01({
				modePurpose,
				roomTempC,
				coolingOnTempC: unitCfg.onTempC,
				roomHumidityPct,
				maxHumidityPct: unitCfg.maxHumidityPct,
			}),
			ownershipOwner,
			overrideActive,
			sharedPowerGroupId: unitCfg.sharedPowerGroupId,
		});
	}

	const sharedResolved = resolveActiveSharedPowerGroupId(climateUnitActive, host.config, null);
	const weatherCfg = weatherConfigFromAdapter(host.config);
	const tempMetric = weatherCfg.metrics.temp;
	const cloudMetric = weatherCfg.metrics.cloud;
	const outdoorTempC = tempMetric ? await readNum(host, tempMetric.actualStateId) : null;
	const cloudPct = cloudMetric ? await readNum(host, cloudMetric.actualStateId) : null;

	const batPower = await readNum(host, BAT.telemetry.powerW);
	const batCharge = await readNum(host, BAT.telemetry.chargingPowerW);
	const batDischarge = await readNum(host, BAT.telemetry.dischargingPowerW);
	let chargeW = batCharge;
	let dischargeW = batDischarge;
	if (chargeW == null && dischargeW == null && batPower != null) {
		if (batPower > 0) chargeW = batPower;
		else if (batPower < 0) dischargeW = Math.abs(batPower);
	}

	const sharedUsed = await readBool(host, AC_RUNTIME_SUMMARY_STATES.systemSharedPowerUsed);
	const systemPower = await readNum(host, AC_RUNTIME_SUMMARY_STATES.systemPowerW);

	const pvLive =
		(await readNum(host, LIVE_PV_POWER_W)) ?? (await readNum(host, LIVE_PV_POWER_W_MIRROR));

	return {
		tsMs: nowMs,
		pvPowerW: pvLive,
		houseTotalPowerW: houseSrc.stateId ? await readNum(host, houseSrc.stateId) : null,
		immersionPowerW: await readNum(host, IMMERSION_RUNTIME_STATES.measuredPowerW),
		wallboxChargePowerW: await readNum(host, WALLBOX_EV_FOUNDATION_STATES.chargePowerW),
		batteryChargePowerW: chargeW,
		batteryDischargePowerW: dischargeW,
		gridBalanceDischargePowerW: await readNum(host, BAT.gridBalance.effectivePowerW),
		gridBalanceRequestedPowerW: await readNum(host, BAT.gridBalance.requestedPowerW),
		gridBalanceActive: await readBool(host, BAT.gridBalance.active),
		batterySetpointOwner: await readStr(host, BAT.runtime.batterySetpointOwner),
		climateSystemPowerW: systemPower,
		climateSharedPowerUsed: sharedUsed,
		climateUnitActive,
		climateMode,
		climateSharedPowerGroupId: sharedResolved.groupId,
		gridImportEnergyKwh: statsCfg.gridImportEnergyKwhStateId
			? await readNum(host, statsCfg.gridImportEnergyKwhStateId)
			: null,
		gridExportEnergyKwh: statsCfg.gridExportEnergyKwhStateId
			? await readNum(host, statsCfg.gridExportEnergyKwhStateId)
			: null,
		gridImportPowerW: statsCfg.gridImportPowerWStateId
			? await readNum(host, statsCfg.gridImportPowerWStateId)
			: null,
		priceCtPerKwh: await resolveTelemetryPriceCtPerKwh(host, nowMs),
		batterySocPct: await readNum(host, BAT.telemetry.socPct),
		evChargePowerW: await readNum(host, WALLBOX_EV_FOUNDATION_STATES.chargePowerW),
		evSocPct: await readNum(host, WALLBOX_EV_FOUNDATION_STATES.vehicleSocPct),
		evConnected: await readBool(host, WALLBOX_EV_FOUNDATION_STATES.vehicleConnected),
		immersionRuntimeOn: null,
		boilerTempC:
			(await readNum(host, IMMERSION_RUNTIME_STATES.boilerTemperatureC)) ??
			(await readNum(host, IMMERSION_RUNTIME_STATES.bufferTemperatureC)),
		otherMeasuredConsumersPowerW: await readNum(
			host,
			MEASURED_CONSUMERS_AGGREGATE_STATES.totalPowerW,
		),
		ownershipActive: null,
		immersionDecisionSource: await readStr(host, IMMERSION_RUNTIME_STATES.decisionSource),
		immersionResolvedMode: await readStr(host, IMMERSION_RUNTIME_STATES.resolvedMode),
		immersionHygieneStatusDe: await readStr(host, IMMERSION_RUNTIME_STATES.hygieneStatusDe),
		immersionOwnershipOwner: await readStr(host, IMMERSION_RUNTIME_STATES.ownershipOwner),
		outdoorTempC,
		cloudPct,
		climateUnits,
	};
}

/** Nach Sample: Immersion-on aus Leistung ableiten. */
export function immersionOnFromPowers(
	measuredW: number | null,
	commandedW: number | null,
): boolean | null {
	if (measuredW != null && Number.isFinite(measuredW)) return measuredW > 50;
	if (commandedW != null && Number.isFinite(commandedW)) return commandedW > 50;
	return null;
}

/** Aktive Unit-Kombination als kompakter String (z. B. "1+3" oder "none"). */
export function activeUnitCombinationKey(active: boolean[]): string {
	const ids: number[] = [];
	for (let i = 0; i < active.length; i++) {
		if (active[i]) ids.push(i + 1);
	}
	return ids.length ? ids.join("+") : "none";
}
