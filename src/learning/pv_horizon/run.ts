import { readStateNum } from "../pv_bias/history";
import type { PvBiasRunHost } from "../pv_bias/run";
import { pvHorizonConfigFromAdapter } from "./config";
import { computePvHorizon } from "./math";
import type { PvHorizonComputeResult } from "./types";
import { PV_HORIZON_DAY_COUNT } from "./constants";

export type PvHorizonRunHost = PvBiasRunHost & {
	log: { info: (msg: string) => void; warn: (msg: string) => void };
};

const BIAS_STATE_IDS = [
	"learning.pv_bias.bias_7d_pct",
	"learning.pv_bias.bias_30d_pct",
	"learning.pv_bias.bias_today_pct",
] as const;

const DAY1_FALLBACK_STATE_IDS = [
	"learning.pv_bias.raw_today_kwh",
	"forecast.pv.today_kwh",
] as const;

const DAY2_FALLBACK_STATE_IDS = [
	"learning.pv_bias.raw_tomorrow_kwh",
	"forecast.pv.tomorrow_kwh",
] as const;

const PV_BIAS_SHORT_HORIZON_SKIP_DAYS = [1, 2] as const;

async function readFirstNum(host: PvHorizonRunHost, ids: readonly string[]): Promise<number | null> {
	for (const id of ids) {
		const n = await readStateNum(host, id);
		if (n !== null) {
			return n;
		}
	}
	return null;
}

async function readBiasPct(host: PvHorizonRunHost): Promise<number | null> {
	for (const id of BIAS_STATE_IDS) {
		const n = await readStateNum(host, id);
		if (n !== null) {
			return n;
		}
	}
	return null;
}

async function resolveRawKwhByDay(
	host: PvHorizonRunHost,
	rawStateIds: string[],
	skipTodayTomorrow: boolean,
): Promise<Array<number | null>> {
	const values: Array<number | null> = [];
	for (let i = 0; i < PV_HORIZON_DAY_COUNT; i++) {
		if (skipTodayTomorrow && i < 2) {
			values.push(null);
			continue;
		}

		let raw: number | null = null;
		const configured = rawStateIds[i];
		if (configured) {
			raw = await readStateNum(host, configured);
		}
		if (raw === null && i === 0) {
			raw = await readFirstNum(host, DAY1_FALLBACK_STATE_IDS);
		}
		if (raw === null && i === 1) {
			raw = await readFirstNum(host, DAY2_FALLBACK_STATE_IDS);
		}
		values.push(raw);
	}
	return values;
}

async function setNumIfValid(host: PvHorizonRunHost, id: string, value: number | null): Promise<void> {
	if (value !== null && Number.isFinite(value)) {
		await host.setStateAsync(id, { val: Math.round(value * 1000) / 1000, ack: true });
	}
}

async function clearHorizonDay(host: PvHorizonRunHost, dayIndex: number): Promise<void> {
	const prefix = `learning.pv_horizon.day${dayIndex}`;
	for (const suffix of ["raw_kwh", "corrected_kwh", "confidence_pct"] as const) {
		await host.setStateAsync(`${prefix}.${suffix}`, { val: null, ack: true });
	}
}

async function writePvHorizonResult(host: PvHorizonRunHost, result: PvHorizonComputeResult): Promise<void> {
	const skipped = new Set(result.skippedDayIndices);
	for (const day of result.days) {
		const prefix = `learning.pv_horizon.day${day.dayIndex}`;
		if (skipped.has(day.dayIndex)) {
			await clearHorizonDay(host, day.dayIndex);
			continue;
		}
		await setNumIfValid(host, `${prefix}.raw_kwh`, day.rawKwh);
		await setNumIfValid(host, `${prefix}.corrected_kwh`, day.correctedKwh);
		await setNumIfValid(host, `${prefix}.confidence_pct`, day.confidencePct);
	}
	await setNumIfValid(host, "learning.pv_horizon.total_7d_raw_kwh", result.total7dRawKwh);
	await setNumIfValid(host, "learning.pv_horizon.total_7d_corrected_kwh", result.total7dCorrectedKwh);
	await setNumIfValid(host, "learning.pv_horizon.days_available", result.daysAvailable);
	await host.setStateAsync("learning.pv_horizon.status", { val: result.status, ack: true });
	await host.setStateAsync("learning.pv_horizon.last_update", {
		val: new Date().toISOString(),
		ack: true,
	});
}

export async function runPvHorizon(host: PvHorizonRunHost): Promise<void> {
	const cfg = pvHorizonConfigFromAdapter(host.config);

	if (!cfg.enabled) {
		await host.setStateAsync("learning.pv_horizon.status", { val: "disabled", ack: true });
		return;
	}

	const skipDayIndices = cfg.skipTodayTomorrowFromPvBias ? [...PV_BIAS_SHORT_HORIZON_SKIP_DAYS] : [];
	const rawByDay = await resolveRawKwhByDay(host, cfg.rawStateIds, cfg.skipTodayTomorrowFromPvBias);
	const biasPct = await readBiasPct(host);
	const baseConfidence = await readStateNum(host, "learning.pv_bias.confidence_pct");

	const result = computePvHorizon(rawByDay, biasPct, baseConfidence, { skipDayIndices });
	await writePvHorizonResult(host, result);

	const scope =
		cfg.skipTodayTomorrowFromPvBias
			? "Tag3-7 (heute/morgen via PV-Bias)"
			: "Tag1-7";
	host.log.info(
		`PV-Horizon [${scope}]: days=${result.daysAvailable}/${result.expectedDays} status=${result.status} total_corr=${result.total7dCorrectedKwh ?? "—"} kWh`,
	);
}
