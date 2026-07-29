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
import { buildPlannerConstraints } from "../planning/battery";
import { WALLBOX_EVCC_STATES } from "../../addons/wallbox/ensure_evcc_states";
import { CONTRIBUTION_IDS } from "../contribution_ids";

let lastRevisionPayload = "";
let revision = 0;

export function resetDailyPlanRevisionForTest(): void {
	lastRevisionPayload = "";
	revision = 0;
}

export function dailyPlanRevisionForTest(): number {
	return revision;
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
	});
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
	});

	const payload = dailyPlanRevisionPayload(plan);
	if (payload !== lastRevisionPayload) {
		revision += 1;
		lastRevisionPayload = payload;
	}
	plan.revision = revision;

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
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.reasonDe, plan.reasonDe);
		await setOptionalNumberIfChanged(host, DAILY_PLAN_STATE_IDS.revision, revision);

		// Roadmap Block 3.3: Briefing + Live-Überschuss/-Defizit aus Daily Plan + Live-Cache —
		// kein Rückgriff mehr auf `formatBriefing()`/`planner.surplus_w` des alten Realtime-Planners.
		const pvFromPv = asNum((await host.getStateAsync("live.pv.power_w"))?.val);
		const pvFromBattery = asNum((await host.getStateAsync("live.battery.pv_ac_power_w"))?.val);
		const liveSurplus = buildOperatorLiveSurplus({
			pvPowerW: pvFromPv ?? pvFromBattery,
			houseLoadW: asNum((await host.getStateAsync("live.battery.house_load_w"))?.val),
			now,
			timezone,
		});
		await setOptionalNumberIfChanged(host, "operator.diagnostics.surplus_w", liveSurplus.surplusW);
		await setOptionalNumberIfChanged(host, "operator.diagnostics.deficit_w", liveSurplus.deficitW);
		await setStateIfChanged(host, "operator.diagnostics.slot_start_iso", liveSurplus.slotStartIso ?? "");
		await setStateIfChanged(
			host,
			"operator.briefing_de",
			buildOperatorBriefingDe(plan, now, timezone, {
				contributions: forecastPlan.contributions,
			}),
		);

		const addonSummaries: Array<{ key: keyof typeof ALLOCATION_ADDON_STATE_IDS; prefix: string }> = [
			{ key: "battery", prefix: "battery" },
			{ key: "wallbox", prefix: "wallbox" },
			{ key: "immersion_heater", prefix: "immersion_heater" },
			{ key: "air_conditioning", prefix: "air_conditioning" },
		];

		for (const { key, prefix } of addonSummaries) {
			const ids = ALLOCATION_ADDON_STATE_IDS[key];
			const view = addonAllocationPublishView(plan, prefix);
			await setStateIfChanged(host, ids.status, view.status);
			await setStateIfChanged(host, ids.planJson, JSON.stringify(view.runnable));
			await setStateIfChanged(host, ids.reasonDe, view.reasonDe);
		}

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
