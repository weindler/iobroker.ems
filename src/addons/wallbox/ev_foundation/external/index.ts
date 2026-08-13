import { isoFromMs } from "../../../../operator/time";
import { intentAdminConfigFromAdapter } from "../../../../intent/config";
import type { EvccTelemetryReadHost } from "../../evcc_telemetry";
import type { EvFoundationConfig } from "../config";
import {
	emptySmartPlanEval,
	type ExternalEvInformation,
	type ExternalSmartPlanEval,
} from "./types";
import {
	parseSmartPlanPayload,
	parseStandaloneStartEnd,
	parseTimestampToMs,
	previewRaw,
	resolveDeadlineIso,
} from "./smart_plan_parse";
import { computeExternalPlanRemainingEnergy, currentOrFutureSlots } from "./remaining_energy";
import {
	externalControlEnabledFromConfig,
	isStale,
	normalizeOptionalBoolOrNull,
	normalizeOptionalSocOrNull,
	normalizeSmartChargingActive,
	resolveExternalSourceQuality,
	sourceIsHealthy,
} from "./quality";

export interface ReadExternalEvOptions {
	now: Date;
	fallbackMaxAcKw: number | null;
	configDepartureAt: string | null;
	timezone: string;
}

interface ForeignRead {
	val: unknown;
	tsMs: number | null;
	lcMs: number | null;
}

async function readForeign(
	host: EvccTelemetryReadHost,
	objectId: string,
): Promise<ForeignRead | null> {
	if (!objectId) return null;
	const st = host.getForeignStateAsync
		? await host.getForeignStateAsync(objectId)
		: await host.getStateAsync(objectId);
	if (!st || st.val === undefined) return null;
	const lc = typeof st.lc === "number" && Number.isFinite(st.lc) ? st.lc : null;
	const ts = typeof st.ts === "number" && Number.isFinite(st.ts) ? st.ts : null;
	return { val: st.val, tsMs: ts, lcMs: lc };
}

function mapped(id: string): boolean {
	return id.trim().length > 0;
}

function maxTs(values: Array<number | null>): number | null {
	let best: number | null = null;
	for (const v of values) {
		if (v === null) continue;
		if (best === null || v > best) best = v;
	}
	return best;
}

function buildSmartPlanEval(input: {
	mappingConfigured: boolean;
	planRead: ForeignRead | null;
	startRead: ForeignRead | null;
	endRead: ForeignRead | null;
	planEnabled: boolean | null;
	nowMs: number;
	deadlineIso: string | null;
	fallbackMaxAcKw: number | null;
}): ExternalSmartPlanEval {
	const eval_: ExternalSmartPlanEval = {
		...emptySmartPlanEval(),
		mappingConfigured: input.mappingConfigured,
	};
	if (!input.mappingConfigured) {
		return eval_;
	}

	const hasPayload = input.planRead != null || (input.startRead != null && input.endRead != null);
	eval_.stateReadable = hasPayload;
	if (!hasPayload) {
		return eval_;
	}

	let parsed = parseSmartPlanPayload(input.planRead?.val ?? null);
	if ((!parsed.parseable || parsed.slots.length === 0) && input.startRead && input.endRead) {
		const pair = parseStandaloneStartEnd(input.startRead.val, input.endRead.val);
		if (pair) {
			parsed = { slots: [pair], ignoredCount: parsed.ignoredCount, parseable: true, error: null };
		}
	}

	eval_.payloadParseable = parsed.parseable;
	eval_.parseError = parsed.error;
	eval_.rawPreview = previewRaw(input.planRead?.val ?? null);
	eval_.parsedSlotCount = parsed.slots.length;
	eval_.ignoredSlotCount = parsed.ignoredCount;

	if (!parsed.parseable) {
		return eval_;
	}

	if (input.planEnabled === false) {
		eval_.validPlanPresent = false;
		eval_.slots = [];
		return eval_;
	}

	const usable = currentOrFutureSlots(parsed.slots, input.nowMs);
	eval_.slots = usable;
	eval_.validPlanPresent = usable.length > 0;
	if (usable.length > 0) {
		eval_.nextStart = usable.reduce(
			(min, s) => (min === null || s.start < min ? s.start : min),
			null as string | null,
		);
		eval_.lastEnd = usable.reduce(
			(max, s) => (max === null || s.end > max ? s.end : max),
			null as string | null,
		);
	}

	const deadlineMs = input.deadlineIso ? Date.parse(input.deadlineIso) : null;
	const remaining = computeExternalPlanRemainingEnergy({
		slots: usable,
		nowMs: input.nowMs,
		deadlineMs: deadlineMs != null && Number.isFinite(deadlineMs) ? deadlineMs : null,
		fallbackMaxAcKw: input.fallbackMaxAcKw,
	});
	eval_.remainingEnergyKWh = remaining.remainingEnergyKWh;
	eval_.remainingMinutes = remaining.remainingMinutes;
	eval_.remainingEnergyEstimated = remaining.estimated;
	eval_.deadlineUsed = input.deadlineIso != null;
	eval_.deadlineIso = input.deadlineIso;
	return eval_;
}

/**
 * Read-only source adapter: generic ioBroker mappings → ExternalEvInformation.
 * Ford/vehicle-pause is diagnostic only and never sets externalControlActive.
 */
export async function readExternalEvInformation(
	host: EvccTelemetryReadHost,
	foundation: EvFoundationConfig,
	opts: ReadExternalEvOptions,
): Promise<ExternalEvInformation> {
	const nowMs = opts.now.getTime();
	const controlEnabled = externalControlEnabledFromConfig(foundation);

	const controlRead = mapped(foundation.externalControlActiveStateId)
		? await readForeign(host, foundation.externalControlActiveStateId)
		: null;
	const rewardsRead = mapped(foundation.externalGridRewardsActiveStateId)
		? await readForeign(host, foundation.externalGridRewardsActiveStateId)
		: null;
	const chargingRead = mapped(foundation.externalSmartChargingStatusStateId)
		? await readForeign(host, foundation.externalSmartChargingStatusStateId)
		: null;
	const planRead = mapped(foundation.externalSmartPlanStateId)
		? await readForeign(host, foundation.externalSmartPlanStateId)
		: null;
	const planEnabledRead = mapped(foundation.externalSmartPlanEnabledStateId)
		? await readForeign(host, foundation.externalSmartPlanEnabledStateId)
		: null;
	const startRead = mapped(foundation.externalSmartPlanStartStateId)
		? await readForeign(host, foundation.externalSmartPlanStartStateId)
		: null;
	const endRead = mapped(foundation.externalSmartPlanEndStateId)
		? await readForeign(host, foundation.externalSmartPlanEndStateId)
		: null;
	const deadlineRead = mapped(foundation.externalPlanDeadlineStateId)
		? await readForeign(host, foundation.externalPlanDeadlineStateId)
		: null;
	const targetRead = mapped(foundation.externalTargetSocStateId)
		? await readForeign(host, foundation.externalTargetSocStateId)
		: null;
	const pauseRead = mapped(foundation.vehicleChargePauseStateId)
		? await readForeign(host, foundation.vehicleChargePauseStateId)
		: null;
	const heartbeatRead = mapped(foundation.externalSourceUpdatedAtStateId)
		? await readForeign(host, foundation.externalSourceUpdatedAtStateId)
		: null;
	const minSocRead = mapped(foundation.externalSmartChargingMinSocStateId)
		? await readForeign(host, foundation.externalSmartChargingMinSocStateId)
		: null;

	const planMappingConfigured =
		mapped(foundation.externalSmartPlanStateId) ||
		(mapped(foundation.externalSmartPlanStartStateId) && mapped(foundation.externalSmartPlanEndStateId));

	const controlMapped = mapped(foundation.externalControlActiveStateId);
	const rewardsMapped = mapped(foundation.externalGridRewardsActiveStateId);
	const chargingMapped = mapped(foundation.externalSmartChargingStatusStateId);

	const configured =
		controlEnabled ||
		controlMapped ||
		rewardsMapped ||
		chargingMapped ||
		planMappingConfigured ||
		mapped(foundation.externalPlanDeadlineStateId) ||
		mapped(foundation.externalTargetSocStateId) ||
		mapped(foundation.externalSmartChargingMinSocStateId) ||
		mapped(foundation.externalSourceUpdatedAtStateId);

	const externalControlActive = controlMapped
		? controlRead
			? normalizeOptionalBoolOrNull(controlRead.val)
			: null
		: null;

	const gridRewardsActive = rewardsMapped
		? rewardsRead
			? normalizeOptionalBoolOrNull(rewardsRead.val)
			: null
		: null;

	const smartChargingActive = chargingMapped
		? chargingRead
			? normalizeSmartChargingActive(chargingRead.val)
			: null
		: null;

	const vehicleChargePauseDiagnostic = mapped(foundation.vehicleChargePauseStateId)
		? pauseRead
			? normalizeOptionalBoolOrNull(pauseRead.val)
			: null
		: null;

	const planEnabled = planEnabledRead ? normalizeOptionalBoolOrNull(planEnabledRead.val) : null;

	const deadlineFromSource =
		deadlineRead && deadlineRead.val != null && deadlineRead.val !== ""
			? resolveDeadlineIso(String(deadlineRead.val), opts.now, opts.timezone)
			: null;
	const deadlineIso =
		deadlineFromSource ?? resolveDeadlineIso(opts.configDepartureAt, opts.now, opts.timezone);

	const smartPlan = buildSmartPlanEval({
		mappingConfigured: planMappingConfigured,
		planRead,
		startRead,
		endRead,
		planEnabled,
		nowMs,
		deadlineIso,
		fallbackMaxAcKw: opts.fallbackMaxAcKw,
	});

	const updatedAtMs = maxTs([
		controlRead?.tsMs ?? null,
		rewardsRead?.tsMs ?? null,
		chargingRead?.tsMs ?? null,
		planRead?.tsMs ?? null,
		planEnabledRead?.tsMs ?? null,
		startRead?.tsMs ?? null,
		endRead?.tsMs ?? null,
		deadlineRead?.tsMs ?? null,
		heartbeatRead?.tsMs ?? null,
		minSocRead?.tsMs ?? null,
	]);

	const freshnessConfigured = mapped(foundation.externalSourceUpdatedAtStateId);
	let freshnessMs: number | null = null;
	if (heartbeatRead) {
		const fromValue = parseTimestampToMs(heartbeatRead.val);
		freshnessMs = fromValue ?? heartbeatRead.tsMs;
	}
	const stale =
		freshnessConfigured && heartbeatRead != null
			? isStale(freshnessMs, nowMs, foundation.externalSourceStaleAfterMin)
			: false;

	const anyMappedMissing =
		(controlMapped && controlRead === null) ||
		(rewardsMapped && rewardsRead === null) ||
		(chargingMapped && chargingRead === null) ||
		(planMappingConfigured && planRead === null && !(startRead && endRead));
	const anyMappedReadable =
		controlRead != null ||
		rewardsRead != null ||
		chargingRead != null ||
		planRead != null ||
		(startRead != null && endRead != null);

	const controlInvalid = controlMapped && controlRead != null && externalControlActive === null;
	const planInvalid = planMappingConfigured && smartPlan.stateReadable && !smartPlan.payloadParseable;
	const planDegraded =
		smartPlan.ignoredSlotCount > 0 ||
		smartPlan.remainingEnergyEstimated ||
		(smartPlan.payloadParseable && !smartPlan.validPlanPresent);

	const quality = resolveExternalSourceQuality({
		configured,
		anyMappedReadable,
		anyMappedMissing,
		controlInvalid,
		planInvalid,
		planDegraded,
		stale,
	});

	const minSocMapped = mapped(foundation.externalSmartChargingMinSocStateId);
	const minSocPct = minSocRead ? normalizeOptionalSocOrNull(minSocRead.val) : null;

	return {
		externalControlConfigured: configured,
		externalControlEnabled: controlEnabled,
		externalControlActive,
		externalControlType: foundation.externalControlType,
		gridRewardsActive,
		smartChargingActive,
		externalSourceHealthy: sourceIsHealthy(quality),
		externalSourceQuality: quality,
		externalSourceUpdatedAt: updatedAtMs != null ? isoFromMs(updatedAtMs) : null,
		vehicleChargePauseDiagnostic,
		smartPlan,
		externalTargetSocPct: targetRead ? normalizeOptionalSocOrNull(targetRead.val) : null,
		externalSmartChargingMinSocPct: minSocPct,
		externalSmartChargingMinSocQuality: !minSocMapped
			? "unconfigured"
			: minSocPct !== null
				? "valid"
				: "unknown",
		freshnessSignalConfigured: freshnessConfigured,
	};
}

export function timezoneFromAdapterConfig(config: unknown): string {
	return intentAdminConfigFromAdapter(config).timezone;
}

export {
	parseSmartPlanPayload,
	parseStandaloneStartEnd,
	parseTimestampToMs,
	resolveDeadlineIso,
} from "./smart_plan_parse";
export { computeExternalPlanRemainingEnergy, currentOrFutureSlots } from "./remaining_energy";
export {
	externalControlEnabledFromConfig,
	normalizeSmartChargingActive,
	resolveExternalSourceQuality,
} from "./quality";
export * from "./types";
