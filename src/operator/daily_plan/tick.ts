import { globalPolicyConfigFromAdapter } from "../../policy/global/config";
import type { PolicySnapshot } from "../../policy/core/types";
import { intentAdminConfigFromAdapter } from "../../intent/config";
import { plannerModePolicyFromGlobalMode } from "../../planner/mode_policy";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../../policy/core/state_write";
import type { ForecastPlan } from "../forecast/types";
import { buildDailyPlanFromForecast, dailyPlanRevisionPayload } from "./build";
import { buildOperatorBriefingDe } from "./briefing";
import { buildOperatorLiveSurplus } from "./live_surplus";
import { addonAllocationPublishView } from "./addon_plan_publish";
import { ALLOCATION_ADDON_STATE_IDS, DAILY_PLAN_STATE_IDS } from "./states";
import type { DailyPlan } from "./types";
import type { ContributionsReadHost } from "../contributions/read";
import {
	batteryConsumersConfigFromAdapter,
	immersionCriticalNow,
	resolveAllBatteryConsumerAccess,
} from "../../policy/battery_consumers";
import { immersionDeviceConfigFromAdapter } from "../../addons/immersion_heater/device_config";
import { IMMERSION_RUNTIME_STATES } from "../../addons/immersion_heater/runtime/types";
import { asNum } from "../../ems_light/state_util";
import { AI_STATES } from "../../ai/ensure_states";
import { buildPlannerConstraints } from "../planning/battery";
import { WALLBOX_EVCC_STATES } from "../../addons/wallbox/ensure_evcc_states";
import { WALLBOX_RUNTIME_STATES } from "../../addons/wallbox/runtime/states";
import {
	wallboxHoldSignalConfigFromAdapter,
} from "../../addons/wallbox/evcc_config";
import { resolveWallboxBatteryHold } from "../../addons/wallbox/charge_hold";
import { normalizeOptionalBool } from "../../addons/wallbox/normalize";
import { CONTRIBUTION_IDS } from "../contribution_ids";
import { BAT } from "../../addons/battery/ensure_states";
import { acUnitRuntimeStates } from "../../addons/air_conditioning/runtime/ensure_states";
import { AC_UNIT_COUNT } from "../../addons/air_conditioning/constants";
import { allocateUnifiedDayPlan } from "./unified/allocate";
import { applyUnifiedIhAcAuthority } from "./unified/authority";
import { buildUnifiedIhAcDispatchPublish } from "./unified/dispatch_bridge";
import {
	buildUnifiedInputFromForecastContext,
	summarizeUnifiedDayPlanForReason,
} from "./unified/from_forecast_context";
import { unifiedPlanCadenceDigest } from "./unified/cadence";
import {
	evaluateMaterialReplan,
	type PlanBaseline,
	type PlanActualSample,
} from "./unified/materiality";
import {
	assessUnifiedReplanFailure,
	applyReplanFailureAuthority,
} from "./unified/replan_failure";
import type { UnifiedDayPlan } from "./unified/types";
import {
	medianGridPriceCtPerKwh,
	priceStructureDigestFromPlan,
} from "../../ai/trigger_digest";
import { resetImmersionDailyPlanCache } from "../../addons/immersion_heater/runtime/daily_plan";
import { resetAcDailyPlanCache } from "../../addons/air_conditioning/runtime/daily_plan";
import { hardwareLimitsFromConfig } from "../../addons/battery/core/limits";
import {
	loadOrEmptyVehiclePresenceStore,
	observeConnected,
	writeVehiclePresencePersist,
} from "../../learning/vehicle_presence";
import { presenceDigest } from "./unified/vehicle_availability";
import { wallboxVehicleMapFromAdapter } from "../../addons/wallbox/vehicle_map/config";
import { lookupVehicleMapEntry } from "../../addons/wallbox/vehicle_map/lookup";

let lastRevisionPayload = "";
let revision = 0;
/** Material-Cadence: ohne relevanten Grund kein neuer Unified-/Tagesplan-Publish. */
let lastCadenceDigest = "";
let unifiedGeneration = 0;
let lastUnifiedPlanId = "";
let lastUnifiedPlan: UnifiedDayPlan | null = null;
let lastBaseline: PlanBaseline | null = null;
let lastReplanAtMs: number | null = null;
let replanCountToday = 0;
let replanCountDate = "";

export function resetDailyPlanRevisionForTest(): void {
	lastRevisionPayload = "";
	revision = 0;
	lastCadenceDigest = "";
	unifiedGeneration = 0;
	lastUnifiedPlanId = "";
	lastUnifiedPlan = null;
	lastBaseline = null;
	lastReplanAtMs = null;
	replanCountToday = 0;
	replanCountDate = "";
}

export function dailyPlanRevisionForTest(): number {
	return revision;
}

/** Test-Hook: wie oft Unified allocate+publish seit Reset gelaufen ist. */
export function unifiedPlanGenerationForTest(): number {
	return unifiedGeneration;
}

export function lastUnifiedPlanIdForTest(): string {
	return lastUnifiedPlanId;
}

async function readStr(host: ContributionsReadHost, relId: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(relId);
		if (st?.val == null || st.val === "") return null;
		return String(st.val);
	} catch {
		return null;
	}
}

async function readEffectivePolicy(host: ContributionsReadHost): Promise<PolicySnapshot | null> {
	const raw = await readStr(host, "policy.global.effective_json");
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PolicySnapshot;
	} catch {
		return null;
	}
}

function policyBool(snapshot: PolicySnapshot | null, key: string): boolean | null {
	const entry = snapshot?.economics?.[key];
	if (!entry || entry.value === null || typeof entry.value !== "boolean") return null;
	return entry.value;
}

function policyNumber(snapshot: PolicySnapshot | null, key: string): number | null {
	const entry = snapshot?.limits?.[key];
	if (!entry || entry.value === null) return null;
	const n = typeof entry.value === "number" ? entry.value : parseFloat(String(entry.value));
	return Number.isFinite(n) ? n : null;
}

function policyStringArray(snapshot: PolicySnapshot | null, key: string): string[] | null {
	const entry = snapshot?.preferences?.[key];
	if (!entry || !Array.isArray(entry.value)) return null;
	return entry.value.filter((v): v is string => typeof v === "string");
}

export async function runDailyPlanTick(
	host: ContributionsReadHost,
	forecastPlan: ForecastPlan,
): Promise<DailyPlan> {
	const now = new Date();
	const adminCfg = intentAdminConfigFromAdapter(host.config);
	const timezone = adminCfg.timezone || "Europe/Berlin";
	const globalModeRaw = (await readStr(host, "global_modes.active")) ?? "balanced";
	const modePolicy = plannerModePolicyFromGlobalMode(globalModeRaw);
	const adminPolicy = globalPolicyConfigFromAdapter(host.config);
	const effectivePolicy = await readEffectivePolicy(host);

	const energyPriority =
		policyStringArray(effectivePolicy, "energyPriority") ?? adminPolicy.energyPriority ?? [];
	const mutualRaw = effectivePolicy?.protection?.mutualExclusions?.value;
	const mutualExclusions = Array.isArray(mutualRaw)
		? (mutualRaw as Array<{ id: string; addonA: string; addonB: string; reason?: string }>)
		: adminPolicy.mutualExclusions ?? [];

	const batConsumers = batteryConsumersConfigFromAdapter(host.config);
	const immersionCfg = immersionDeviceConfigFromAdapter(host.config);
	const socPct = asNum((await host.getStateAsync("live.battery.soc_pct"))?.val);
	const bufferTempC = asNum((await host.getStateAsync("live.thermal.buffer_temp_c"))?.val);
	const evccMode = await readStr(host, WALLBOX_EVCC_STATES.batteryMode);
	const evccDischargeRaw = await host.getStateAsync(WALLBOX_EVCC_STATES.batteryDischargeControl);
	const evccDischarge = evccDischargeRaw?.val === true;
	const batteryBoostRaw = await host.getStateAsync(WALLBOX_EVCC_STATES.batteryBoost);
	const batteryBoost =
		batteryBoostRaw?.val === true ? true : batteryBoostRaw?.val === false ? false : null;
	const loadpointMode = await readStr(host, WALLBOX_EVCC_STATES.loadpointMode);
	const holdSignals = wallboxHoldSignalConfigFromAdapter(host.config);
	let externalVehicleChargeRaw: string | boolean | null = null;
	if (holdSignals.externalVehicleChargeStateId) {
		try {
			const st = await host.getForeignStateAsync?.(holdSignals.externalVehicleChargeStateId);
			if (st?.val !== undefined && st.val !== null) {
				externalVehicleChargeRaw =
					typeof st.val === "boolean" ? st.val : String(st.val);
			}
		} catch {
			externalVehicleChargeRaw = null;
		}
	}
	let tibberGridRewardsActive: boolean | null = null;
	if (holdSignals.tibberGridRewardsActiveStateId) {
		try {
			const st = await host.getForeignStateAsync?.(holdSignals.tibberGridRewardsActiveStateId);
			const n = normalizeOptionalBool(st?.val);
			tibberGridRewardsActive = n.status === "valid" ? n.value : null;
		} catch {
			tibberGridRewardsActive = null;
		}
	}
	const wallboxHold = resolveWallboxBatteryHold({
		batteryBoost,
		loadpointMode,
		externalVehicleChargeRaw,
		tibberGridRewardsActive,
	});
	try {
		await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, wallboxHold.hold);
		await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.batteryHoldReasonDe, wallboxHold.reasonDe);
		await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.chargeBoostActive, wallboxHold.boostActive);
		await setStateIfChanged(
			host,
			WALLBOX_RUNTIME_STATES.externalVehicleChargeActive,
			wallboxHold.externalActive,
		);
		await setStateIfChanged(
			host,
			WALLBOX_RUNTIME_STATES.tibberGridRewardsActive,
			wallboxHold.tibberRewardsActive,
		);
	} catch {
		// hold publish best-effort
	}
	const batteryIntentRaw = await readStr(host, "user_intent.battery.resolved_json");
	let userHold = false;
	if (batteryIntentRaw) {
		try {
			const parsed = JSON.parse(batteryIntentRaw) as { operating_request?: { value?: string } };
			userHold = parsed.operating_request?.value === "hold";
		} catch {
			userHold = false;
		}
	}
	const hold = buildPlannerConstraints({
		evccBatteryMode: evccMode,
		evccBatteryDischargeControl: evccDischarge,
		userIntentBatteryHold: userHold,
		wallboxChargeHold: wallboxHold.hold,
		wallboxChargeHoldReasonDe: wallboxHold.reasonDe,
	});
	try {
		await setStateIfChanged(host, "planner.constraints.evcc_battery_hold", hold.evcc_battery_hold);
		await setStateIfChanged(host, "planner.constraints.battery_hold_active", hold.battery_hold_active);
	} catch {
		// constraint publish best-effort
	}
	const consumerAccess = resolveAllBatteryConsumerAccess({
		config: batConsumers,
		batteryHoldActive: hold.battery_hold_active,
		socPct,
		criticalByConsumer: {
			immersion_heater: immersionCriticalNow(
				bufferTempC,
				immersionCfg.planningMinTempC,
				batConsumers.immersion_heater.criticalMarginK,
			),
			air_conditioning: null,
			wallbox: false,
		},
	});

	const pvFromPvEarly = asNum((await host.getStateAsync("live.pv.power_w"))?.val);
	const pvFromBatteryEarly = asNum((await host.getStateAsync("live.battery.pv_ac_power_w"))?.val);
	const liveSurplusEarly = buildOperatorLiveSurplus({
		pvPowerW: pvFromPvEarly ?? pvFromBatteryEarly,
		houseLoadW: asNum((await host.getStateAsync("live.battery.house_load_w"))?.val),
		now,
		timezone,
	});

	let plan = buildDailyPlanFromForecast(now, timezone, modePolicy.mode, forecastPlan, {
		policySnapshot: effectivePolicy as unknown as Record<string, unknown> | null,
		energyPriority,
		mutualExclusions,
		gridImportAllowedPolicy:
			policyBool(effectivePolicy, "gridImportAllowed") ?? adminPolicy.gridImportAllowed,
		effectiveMaxGridImportW: policyNumber(effectivePolicy, "maxGridImportW") ?? adminPolicy.maxGridImportW,
		configuredHouseFuseLimitW:
			policyNumber(effectivePolicy, "houseFuseLimitW") ?? adminPolicy.houseFuseLimitW,
		modePolicy,
		batteryConsumerAccess: consumerAccess,
		batteryDischargeBudgetW: batConsumers.maxDischargePowerW,
		livePvSurplusW: liveSurplusEarly.surplusW,
	});

	const payload = dailyPlanRevisionPayload(plan);
	if (payload !== lastRevisionPayload) {
		revision += 1;
		lastRevisionPayload = payload;
	}
	plan.revision = revision;

	const cadenceDigest = unifiedPlanCadenceDigest(plan);

	// Live-Diagnose darf jeden Tick — Tagesplan/Unified nur bei Material-Replan.
	try {
		await setOptionalNumberIfChanged(host, "operator.diagnostics.surplus_w", liveSurplusEarly.surplusW);
		await setOptionalNumberIfChanged(host, "operator.diagnostics.deficit_w", liveSurplusEarly.deficitW);
		await setStateIfChanged(host, "operator.diagnostics.slot_start_iso", liveSurplusEarly.slotStartIso ?? "");
	} catch {
		// best-effort
	}

	const bufferSt = await host.getStateAsync(IMMERSION_RUNTIME_STATES.bufferTemperatureC);
	const batSocSt = await host.getStateAsync(BAT.telemetry.socPct);
	const batCap = asNum((await host.getStateAsync(BAT.telemetry.capacityEffectiveKwh))?.val);
	const hw = hardwareLimitsFromConfig(host.config);
	const roomTemps: Partial<Record<number, number | null>> = {};
	for (let u = 1; u <= AC_UNIT_COUNT; u++) {
		roomTemps[u] = asNum((await host.getStateAsync(acUnitRuntimeStates(u).roomTempC))?.val);
	}
	const realizedPv = asNum((await host.getStateAsync("learning.energy_daily.pv_kwh"))?.val);
	const wbConnectedRaw = await host.getStateAsync(WALLBOX_EVCC_STATES.connected);
	const wbConnected =
		wbConnectedRaw?.val === true ? true : wbConnectedRaw?.val === false ? false : null;

	const absPath = (host as { getAbsolutePath?: (c?: string) => string }).getAbsolutePath;
	const presenceDir = typeof absPath === "function" ? absPath("learning/vehicle_presence") : null;
	let presenceStore = await loadOrEmptyVehiclePresenceStore(presenceDir);
	const vehicleName = await readStr(host, WALLBOX_EVCC_STATES.vehicleName);
	const vehicleTitle = await readStr(host, WALLBOX_EVCC_STATES.vehicleTitle);
	const mapEntry = lookupVehicleMapEntry(
		wallboxVehicleMapFromAdapter(host.config).entries,
		vehicleName,
		vehicleTitle,
	);
	// Ohne Map-Treffer: keine erfundene ID — Learning/Prediction aussetzen.
	const presenceVehicleKey = mapEntry?.evccVehicleId ?? null;
	if (wbConnected !== null && presenceVehicleKey) {
		const nextStore = observeConnected(
			presenceStore,
			now.getTime(),
			timezone,
			wbConnected,
			presenceVehicleKey,
		);
		if (nextStore !== presenceStore && presenceDir) {
			try {
				await writeVehiclePresencePersist(presenceDir, nextStore);
			} catch (e) {
				host.log?.warn?.(`vehicle_presence persist: ${String(e)}`);
			}
		}
		presenceStore = nextStore;
	}

	const probeInput = buildUnifiedInputFromForecastContext({
		now,
		timezone,
		globalMode: plan.globalMode,
		forecastPlan,
		bufferTempC: asNum(bufferSt?.val),
		batterySocPct: asNum(batSocSt?.val),
		batteryCapacityKwh: batCap,
		batteryMaxChargePowerW: hw.maxChargeW,
		batteryMaxDischargePowerW: hw.maxDischargeW,
		batteryMinSocPct: hw.minSocPct,
		batteryMaxSocPct: hw.maxSocPct,
		roomTemps,
		observedPvPowerW: asNum((await host.getStateAsync("live.battery.pv_ac_power_w"))?.val),
		observedHouseLoadPowerW: asNum((await host.getStateAsync("live.battery.house_load_w"))?.val),
		contributionRevision: plan.revision,
		previousExpectedDayEnergyKwh: lastBaseline?.expectedPvDayKwh ?? null,
		realizedPvKwhToday: realizedPv,
		vehiclePresenceLearning: presenceStore,
		vehiclePresenceVehicleKey: presenceVehicleKey,
		connectedNowOverride: wbConnected,
	});

	const actualSample: PlanActualSample = {
		date: plan.date,
		nowMs: now.getTime(),
		forecastPvDayKwh: probeInput.pv.expectedDayEnergyKwh,
		realizedPvKwh: realizedPv,
		forecastHouseLoadDayKwh: probeInput.houseLoad.expectedDayEnergyKwh,
		batterySocPct: probeInput.battery.socPct,
		thermalHeadroomKwh: probeInput.thermal?.headroomEnergyKwh ?? null,
		bufferTempC: probeInput.thermal?.bufferTempC ?? null,
		acMandatoryAny: probeInput.climate?.units.some((u) => u.mandatoryComfort) === true,
		vehicleConnected: probeInput.wallbox?.connectedNow ?? wbConnected,
		vehicleRequiredEnergyKwh: probeInput.wallbox?.requiredEnergyKwh ?? null,
		vehicleDeadlineIso: probeInput.wallbox?.deadlineIso ?? null,
		vehicleTargetSocPct: probeInput.wallbox?.targetSocPct ?? null,
		priceMedianCt: medianGridPriceCtPerKwh(plan),
		priceStructureDigest: priceStructureDigestFromPlan(plan),
		presenceDigest: presenceDigest(probeInput.wallbox?.presenceWindows ?? []),
		thermalBlocked: probeInput.thermal?.uncertainty.status === "blocked",
		cadenceDigest,
	};

	const decision = evaluateMaterialReplan(lastBaseline, actualSample, {
		lastReplanAtMs,
	});

	if (!decision.shouldReplan) {
		return plan;
	}

	// Roadmap Block 6: vorhandene KI-Präferenzen → Plan B auf Allocation, wenn messbar besser.
	try {
		const { maybeApplyAiWritebackOnDailyPlan } = await import("../../ai/writeback/index.js");
		plan = await maybeApplyAiWritebackOnDailyPlan(
			host as Parameters<typeof maybeApplyAiWritebackOnDailyPlan>[0],
			plan,
		);
	} catch (e) {
		host.log?.warn?.(`ai_writeback: ${String(e)}`);
	}

	try {
		/*
		 * IH/AC Authority: Unified zuerst in Memory mergen, dann einmal publizieren.
		 * Kein klassischer IH/AC-Live-Publish vor Unified (Race vermeiden).
		 * Battery/Wallbox bleiben klassisch im Plan.
		 */
		let ihAcReasonSuffix = "";
		try {
			const bufferTs =
				typeof bufferSt?.ts === "number" && Number.isFinite(bufferSt.ts)
					? new Date(bufferSt.ts).toISOString()
					: null;
			const batSocTs =
				typeof batSocSt?.ts === "number" && Number.isFinite(batSocSt.ts)
					? new Date(batSocSt.ts).toISOString()
					: null;
			const unifiedInputFinal = buildUnifiedInputFromForecastContext({
				now,
				timezone,
				globalMode: plan.globalMode,
				forecastPlan,
				bufferTempC: asNum(bufferSt?.val),
				bufferTempObservedAtIso: bufferTs,
				batterySocPct: asNum(batSocSt?.val),
				batteryCapacityKwh: batCap,
				batterySocObservedAtIso: batSocTs,
				batteryMaxChargePowerW: hw.maxChargeW,
				batteryMaxDischargePowerW: hw.maxDischargeW,
				batteryMinSocPct: hw.minSocPct,
				batteryMaxSocPct: hw.maxSocPct,
				roomTemps,
				observedPvPowerW: asNum((await host.getStateAsync("live.battery.pv_ac_power_w"))?.val),
				observedHouseLoadPowerW: asNum((await host.getStateAsync("live.battery.house_load_w"))?.val),
				contributionRevision: plan.revision,
				previousExpectedDayEnergyKwh: lastBaseline?.expectedPvDayKwh ?? null,
				realizedPvKwhToday: realizedPv,
				vehiclePresenceLearning: presenceStore,
				vehiclePresenceVehicleKey: presenceVehicleKey,
				connectedNowOverride: wbConnected,
			});

			const nextGen = (lastUnifiedPlan?.generation ?? 0) + 1;
			const unifiedPlan = allocateUnifiedDayPlan(unifiedInputFinal, {
				generation: nextGen,
				extraReasonCodes: decision.reasons,
				previousPlan: lastUnifiedPlan,
			});
			unifiedGeneration += 1;
			lastUnifiedPlanId = unifiedPlan.planId;
			lastUnifiedPlan = unifiedPlan;
			lastReplanAtMs = now.getTime();
			lastCadenceDigest = cadenceDigest;
			if (replanCountDate !== plan.date) {
				replanCountDate = plan.date;
				replanCountToday = 0;
			}
			replanCountToday += 1;
			lastBaseline = {
				date: plan.date,
				planId: unifiedPlan.planId,
				generation: unifiedPlan.generation,
				createdAtMs: now.getTime(),
				expectedPvDayKwh: unifiedInputFinal.pv.expectedDayEnergyKwh,
				realizedPvKwhAtPlan: realizedPv,
				expectedHouseLoadDayKwh: unifiedInputFinal.houseLoad.expectedDayEnergyKwh,
				batterySocPct: unifiedInputFinal.battery.socPct,
				thermalHeadroomKwh: unifiedInputFinal.thermal?.headroomEnergyKwh ?? null,
				bufferTempC: unifiedInputFinal.thermal?.bufferTempC ?? null,
				acMandatoryAny: unifiedInputFinal.climate?.units.some((u) => u.mandatoryComfort) === true,
				vehicleConnected: unifiedInputFinal.wallbox?.connectedNow ?? null,
				vehicleRequiredEnergyKwh: unifiedInputFinal.wallbox?.requiredEnergyKwh ?? null,
				vehicleDeadlineIso: unifiedInputFinal.wallbox?.deadlineIso ?? null,
				vehicleTargetSocPct: unifiedInputFinal.wallbox?.targetSocPct ?? null,
				priceMedianCt: medianGridPriceCtPerKwh(plan),
				priceStructureDigest: priceStructureDigestFromPlan(plan),
				presenceDigest: presenceDigest(unifiedInputFinal.wallbox?.presenceWindows ?? []),
				cadenceDigest,
			};

			const pub = buildUnifiedIhAcDispatchPublish(unifiedPlan);
			plan = applyUnifiedIhAcAuthority(plan, pub.immersionEntries, pub.climateEntries, {
				dailyPlanRevision: plan.revision,
				unifiedPlanId: unifiedPlan.planId,
			});
			ihAcReasonSuffix =
				` ${summarizeUnifiedDayPlanForReason(unifiedPlan)} IH/AC autoritativ` +
				(decision.reasons.length ? ` [${decision.reasons.join(",")}]` : "") +
				` replansToday=${replanCountToday}.`;
		} catch (e) {
			/*
			 * Replan fehlgeschlagen: keine neue Unified-Generation.
			 * IH: im Zweifel idle (kein veralteter energetischer Slice).
			 * AC: planbasierten Flex leeren bei Komfortbedarf → lokaler Runtime-Komfort-Pfad.
			 * Wenn Restplan noch sicher: nichts publishen (letzter Publish bleibt).
			 */
			host.log?.warn?.(`unified ih/ac replan failed — assess rest safety: ${String(e)}`);
			const disposition = assessUnifiedReplanFailure({
				nowMs: now.getTime(),
				lastUnifiedPlan,
				actual: actualSample,
				thermal: probeInput.thermal,
				climate: probeInput.climate,
				replanReasons: decision.reasons,
			});
			ihAcReasonSuffix = ` ${disposition.reasonDe}`;
			if (!disposition.clearImmersion && !disposition.clearClimate) {
				// FAIL-003: Restplan weiter gültig — kein Authority-Publish, keine neue Generation.
				return plan;
			}
			plan = applyReplanFailureAuthority(plan, lastUnifiedPlan, disposition);
			if (disposition.clearImmersion && lastUnifiedPlan) {
				const nowMs = now.getTime();
				lastUnifiedPlan = {
					...lastUnifiedPlan,
					allocations: lastUnifiedPlan.allocations.filter(
						(a) =>
							a.kind !== "immersion_heater" ||
							!(Number.isFinite(Date.parse(a.slot.endIso)) && Date.parse(a.slot.endIso) > nowMs),
					),
				};
			}
			if (disposition.clearClimate && lastUnifiedPlan) {
				const nowMs = now.getTime();
				lastUnifiedPlan = {
					...lastUnifiedPlan,
					allocations: lastUnifiedPlan.allocations.filter(
						(a) =>
							a.kind !== "climate" ||
							!(Number.isFinite(Date.parse(a.slot.endIso)) && Date.parse(a.slot.endIso) > nowMs),
					),
				};
			}
		}

		const publishReasonDe = `${plan.reasonDe}${ihAcReasonSuffix}`.slice(0, 480);

		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.status, plan.status);
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.generatedAt, plan.generatedAt);
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "");
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.date, plan.date);
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.globalMode, plan.globalMode);
		await setOptionalNumberIfChanged(host, DAILY_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes);
		await setStateIfChanged(
			host,
			DAILY_PLAN_STATE_IDS.activeContributionsJson,
			JSON.stringify(plan.activeContributionIds),
		);
		await setStateIfChanged(
			host,
			DAILY_PLAN_STATE_IDS.excludedContributionsJson,
			JSON.stringify(plan.excludedContributions),
		);
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.slotsJson, JSON.stringify(plan.slots));
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.allocationsJson, JSON.stringify(plan.allocations));
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.totalsJson, JSON.stringify(plan.totals));
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.unallocatedJson, JSON.stringify(plan.unallocated));
		await setStateIfChanged(
			host,
			DAILY_PLAN_STATE_IDS.policySnapshotJson,
			JSON.stringify(plan.policySnapshot),
		);
		await setStateIfChanged(
			host,
			DAILY_PLAN_STATE_IDS.constraintSnapshotJson,
			JSON.stringify(plan.constraintSnapshot),
		);
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.planJson, JSON.stringify(plan));
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.reasonDe, publishReasonDe);
		await setOptionalNumberIfChanged(host, DAILY_PLAN_STATE_IDS.revision, revision);

		const aiThinkingRaw = await host.getStateAsync(AI_STATES.lastThinkingDe);
		const aiThinkingDe =
			typeof aiThinkingRaw?.val === "string" && aiThinkingRaw.val.trim() ? aiThinkingRaw.val.trim() : null;
		await setStateIfChanged(
			host,
			"operator.briefing_de",
			buildOperatorBriefingDe(plan, now, timezone, {
				contributions: forecastPlan.contributions,
				aiThinkingDe,
			}),
		);

		// Finale Addon-Slices aus dem (bereits gemergten) Plan — eine Wahrheit.
		const addonSummaries: Array<{ key: keyof typeof ALLOCATION_ADDON_STATE_IDS; prefix: string }> = [
			{ key: "battery", prefix: "battery" },
			{ key: "wallbox", prefix: "wallbox" },
			{ key: "immersion_heater", prefix: "immersion_heater" },
			{ key: "air_conditioning", prefix: "air_conditioning" },
		];

		for (const { key, prefix } of addonSummaries) {
			const ids = ALLOCATION_ADDON_STATE_IDS[key];
			const view = addonAllocationPublishView(plan, prefix);
			let reasonDe = view.reasonDe;
			if (key === "immersion_heater" || key === "air_conditioning") {
				reasonDe = ihAcReasonSuffix.trim()
					? `${view.reasonDe} ${ihAcReasonSuffix.trim()}`
					: view.reasonDe;
			}
			await setStateIfChanged(host, ids.status, view.status);
			await setStateIfChanged(host, ids.planJson, JSON.stringify(view.runnable));
			await setStateIfChanged(host, ids.reasonDe, reasonDe.slice(0, 480));
		}
		resetImmersionDailyPlanCache();
		resetAcDailyPlanCache();

		// Heizstab-Tagesziel aus Contribution-Details (gleiche Forecast-Logik wie Allocation).
		const ihFlex = forecastPlan.contributions.find(
			(c) => c.contributionId === CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
		);
		const ihMand = forecastPlan.contributions.find(
			(c) => c.contributionId === CONTRIBUTION_IDS.IMMERSION_MANDATORY,
		);
		const ihDetails = ihFlex?.details ?? ihMand?.details ?? null;
		const targetTemp =
			ihDetails && typeof ihDetails.targetTempC === "number" && Number.isFinite(ihDetails.targetTempC)
				? ihDetails.targetTempC
				: null;
		if (targetTemp !== null) {
			await setOptionalNumberIfChanged(host, IMMERSION_RUNTIME_STATES.planTargetTempC, targetTemp);
			const reasonFromDetails =
				ihDetails && typeof ihDetails.targetReasonDe === "string" ? ihDetails.targetReasonDe : "";
			const reason =
				reasonFromDetails.trim() ||
				(typeof ihFlex?.reasonDe === "string" && ihFlex.reasonDe.trim() ? ihFlex.reasonDe : "") ||
				`Plan-Tagesziel ${targetTemp} °C.`;
			await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.planTargetReasonDe, reason);
		}
	} catch (e) {
		host.log?.warn?.(`daily plan state write: ${String(e)}`);
		try {
			await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.status, "error");
			await setStateIfChanged(
				host,
				DAILY_PLAN_STATE_IDS.reasonDe,
				`Daily Plan Fehler: ${String(e)}`.slice(0, 480),
			);
		} catch {
			// ignore
		}
	}

	return plan;
}
