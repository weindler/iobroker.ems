/**
 * Schreibt die operative Einschätzung aus bereits bekanntem Plan + Live-States.
 */

import { asNum } from "../../ems_light/state_util";
import { BAT } from "../../addons/battery/ensure_states";
import { IMMERSION_RUNTIME_STATES } from "../../addons/immersion_heater/runtime/types";
import { setStateIfChanged } from "../../policy/core/state_write";
import type { StateHost } from "../../ems_light/state_util";
import type { PlanContribution } from "../types";
import type { UnifiedDayPlan, UnifiedDayPlannerInput } from "../daily_plan/unified/types";
import { buildAddonStrategicPlanSnapshot } from "../../beta/strategic_status";
import {
	buildOperationalAssessment,
	formatOperationalAssessmentDe,
	type AssessmentBuildInput,
} from "./build";

export const OPERATOR_ASSESSMENT_JSON = "operator.assessment.json";
export const OPERATOR_ASSESSMENT_DE = "operator.assessment_de";

export type AssessmentPublishHost = {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

function asBool(v: unknown): boolean | null {
	if (v === true || v === false) return v;
	if (v === 1 || v === "1" || v === "true") return true;
	if (v === 0 || v === "0" || v === "false") return false;
	return null;
}

async function readNum(host: AssessmentPublishHost, id: string): Promise<number | null> {
	try {
		return asNum((await host.getStateAsync(id))?.val);
	} catch {
		return null;
	}
}

async function readStr(host: AssessmentPublishHost, id: string): Promise<string | null> {
	try {
		const v = (await host.getStateAsync(id))?.val;
		if (v == null || v === "") return null;
		return String(v);
	} catch {
		return null;
	}
}

async function readBool(host: AssessmentPublishHost, id: string): Promise<boolean | null> {
	try {
		return asBool((await host.getStateAsync(id))?.val);
	} catch {
		return null;
	}
}

export async function publishOperationalAssessment(
	host: AssessmentPublishHost,
	input: {
		now: Date;
		timezone: string;
		plan: UnifiedDayPlan | null;
		plannerInput: UnifiedDayPlannerInput | null;
		contributions: PlanContribution[];
	},
): Promise<void> {
	const [
		pvTodayKwh,
		pvTomorrowKwh,
		weatherTodayMinC,
		weatherTodayMaxC,
		weatherTomorrowMinC,
		weatherTomorrowMaxC,
		surplusW,
		priceNowCt,
		gbEnabled,
		gbActive,
		gbReady,
		gbPriceAllowed,
		gbBlock,
		gbRequested,
		gbMin,
		gbPrice,
		ihMode,
		ihAuto,
		ihHygieneJson,
	] = await Promise.all([
		readNum(host, "learning.pv_bias.corrected_today_kwh"),
		readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
		readNum(host, "learning.weather.horizon.day1.min_temp_c"),
		readNum(host, "learning.weather.horizon.day1.max_temp_c"),
		readNum(host, "learning.weather.horizon.day2.min_temp_c"),
		readNum(host, "learning.weather.horizon.day2.max_temp_c"),
		readNum(host, "operator.diagnostics.surplus_w"),
		readNum(host, "live.price.now_ct_per_kwh"),
		readBool(host, BAT.gridBalance.enabled),
		readBool(host, BAT.gridBalance.active),
		readBool(host, BAT.gridBalance.ready),
		readBool(host, BAT.gridBalance.priceAllowed),
		readStr(host, BAT.gridBalance.blockReason),
		readNum(host, BAT.gridBalance.requestedPowerW),
		readNum(host, BAT.gridBalance.priceMinCtKwh),
		readNum(host, BAT.gridBalance.currentPriceCtKwh),
		readStr(host, "addons.immersion_heater.mode"),
		readBool(host, IMMERSION_RUNTIME_STATES.autoTargetReached),
		readStr(host, "addons.immersion_heater.runtime.hygiene_json"),
	]);

	const ihForced = ihMode === "force";
	let hygieneDue = input.plannerInput?.thermal?.hygieneDue === true;
	if (ihHygieneJson) {
		try {
			const j = JSON.parse(ihHygieneJson) as { due?: boolean };
			if (j?.due === true) hygieneDue = true;
		} catch {
			/* ignore */
		}
	}

	const thermal = input.plannerInput?.thermal ?? null;
	const strategy =
		input.plan && input.plannerInput
			? buildAddonStrategicPlanSnapshot({
					plan: input.plan,
					plannerInput: input.plannerInput,
					nowMs: input.now.getTime(),
					generatedAtIso: input.now.toISOString(),
				})
			: null;

	const buildInput: AssessmentBuildInput = {
		now: input.now,
		timezone: input.timezone,
		plan: input.plan,
		plannerInput: input.plannerInput,
		contributions: input.contributions,
		strategy,
		pvTodayKwh,
		pvTomorrowKwh,
		weatherTodayMinC,
		weatherTodayMaxC,
		weatherTomorrowMinC,
		weatherTomorrowMaxC,
		surplusW,
		priceNowCt,
		gb: {
			enabled: gbEnabled,
			active: gbActive,
			ready: gbReady,
			priceAllowed: gbPriceAllowed,
			blockReason: gbBlock,
			requestedPowerW: gbRequested,
			minPriceCt: gbMin,
			currentPriceCt: gbPrice ?? priceNowCt,
		},
		immersion: {
			boilerTempC: thermal?.boilerTempC ?? (await readNum(host, "live.thermal.boiler_temp_c")),
			bufferTempC: thermal?.bufferTempC ?? (await readNum(host, "live.thermal.buffer_temp_c")),
			targetTempC: thermal?.dayTargetTempC ?? thermal?.forecastTargetTempC ?? null,
			maxTempC: thermal?.maxTempC ?? null,
			boilerMinC: thermal?.boilerMinTempC ?? thermal?.minTempC ?? null,
			hygieneDue,
			forced: ihForced,
			autoTargetReached: ihAuto === true,
			requiredFlexKwh: null,
			mode: ihMode,
		},
	};

	const assessment = buildOperationalAssessment(buildInput);
	const writer = host as unknown as StateHost;
	await setStateIfChanged(writer, OPERATOR_ASSESSMENT_JSON, JSON.stringify(assessment));
	await setStateIfChanged(writer, OPERATOR_ASSESSMENT_DE, formatOperationalAssessmentDe(assessment));
}
