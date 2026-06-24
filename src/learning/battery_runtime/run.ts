import {
	batteryRuntimeConfigFromAdapter,
	nightAstroConfigReady,
	sourceLabelFromStateId,
} from "./config";
import {
	distinctSocSampleDays,
	fetchAstroTimeHistory,
	fetchPowerHistory,
	fetchSocHistory,
	mergeDailyAstroTimes,
	readLiveCapacityKwh,
	readLiveSoc,
} from "./history";
import { resolveBatteryRuntimeSources } from "./mapping";
import {
	computeBatteryRuntimeLearning,
	disabledResult,
	errorResult,
	noSourceResult,
} from "./math";
import { writeBatteryRuntimePersist } from "./persist";
import type { BatteryRuntimeComputeResult } from "./types";

export type BatteryRuntimeRunHost = {
	config: unknown;
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	getAbsolutePath?: (category?: string) => string;
	log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
};

async function setNumIfValid(
	host: BatteryRuntimeRunHost,
	id: string,
	value: number | null,
): Promise<void> {
	if (value !== null && Number.isFinite(value)) {
		await host.setStateAsync(id, { val: value, ack: true });
	}
}

async function writeResult(
	host: BatteryRuntimeRunHost,
	result: BatteryRuntimeComputeResult,
	lastRun: string,
): Promise<void> {
	await host.setStateAsync("learning.battery_runtime.status", { val: result.status, ack: true });
	await host.setStateAsync("learning.battery_runtime.last_run", { val: lastRun, ack: true });
	await setNumIfValid(host, "learning.battery_runtime.sample_days", result.sampleDays);
	await setNumIfValid(host, "learning.battery_runtime.avg_night_discharge_pct", result.avgNightDischargePct);
	await setNumIfValid(host, "learning.battery_runtime.avg_night_discharge_kwh", result.avgNightDischargeKwh);
	await setNumIfValid(host, "learning.battery_runtime.avg_charge_rate_pct_h", result.avgChargeRatePctH);
	await setNumIfValid(
		host,
		"learning.battery_runtime.avg_discharge_rate_pct_h",
		result.avgDischargeRatePctH,
	);
	await setNumIfValid(host, "learning.battery_runtime.avg_charge_power_w", result.avgChargePowerW);
	await setNumIfValid(host, "learning.battery_runtime.avg_discharge_power_w", result.avgDischargePowerW);
	await setNumIfValid(host, "learning.battery_runtime.max_charge_power_w", result.maxChargePowerW);
	await setNumIfValid(host, "learning.battery_runtime.max_discharge_power_w", result.maxDischargePowerW);
	await host.setStateAsync("learning.battery_runtime.last_full_charge", {
		val: result.lastFullCharge ?? "",
		ack: true,
	});
	await setNumIfValid(host, "learning.battery_runtime.days_since_full", result.daysSinceFull);
	await setNumIfValid(host, "learning.battery_runtime.topoff_interval_days", result.topoffIntervalDays);
	await setNumIfValid(host, "learning.battery_runtime.topoff_days_remaining", result.topoffDaysRemaining);
	if (result.topoffDue !== null) {
		await host.setStateAsync("learning.battery_runtime.topoff_due", {
			val: result.topoffDue ? 1 : 0,
			ack: true,
		});
	}
	await setNumIfValid(host, "learning.battery_runtime.estimated_runtime_days", result.estimatedRuntimeDays);
}

export async function runBatteryRuntimeLearning(host: BatteryRuntimeRunHost): Promise<void> {
	const cfg = batteryRuntimeConfigFromAdapter(host.config);
	const now = new Date();
	const lastRun = now.toISOString();

	if (!cfg.enabled) {
		await writeResult(host, disabledResult(cfg), lastRun);
		return;
	}

	const sources = await resolveBatteryRuntimeSources(host, {
		socStateId: cfg.socStateId,
		powerStateId: cfg.powerStateId,
		capacityStateId: cfg.capacityStateId,
	});

	if (!sources.socStateId) {
		await writeResult(host, noSourceResult(cfg), lastRun);
		return;
	}

	try {
		const [socHist, powerHist, capacityKwh, currentSocPct, astroDaily] = await Promise.all([
			fetchSocHistory(host, sources.socStateId, cfg.lookbackDays),
			sources.powerStateId
				? fetchPowerHistory(host, sources.powerStateId, cfg.lookbackDays, cfg.powerInvert)
				: Promise.resolve({ points: [], lastValidTs: null }),
			readLiveCapacityKwh(host, sources.capacityStateId),
			readLiveSoc(host, sources.socStateId),
			nightAstroConfigReady(cfg)
				? (async () => {
						const startPts = await fetchAstroTimeHistory(host, cfg.nightStartStateId, cfg.lookbackDays);
						const endPts = await fetchAstroTimeHistory(host, cfg.nightEndStateId, cfg.lookbackDays);
						return mergeDailyAstroTimes(startPts, endPts);
					})()
				: Promise.resolve(null),
		]);

		const sampleDays = distinctSocSampleDays(socHist.points);
		const result = computeBatteryRuntimeLearning({
			socPoints: socHist.points,
			powerPoints: powerHist.points,
			capacityKwh,
			currentSocPct,
			cfg,
			sourceSocStateId: sources.socStateId,
			sourcePowerStateId: sources.powerStateId,
			now,
			sampleDays,
			astroDaily,
		});

		if (host.getAbsolutePath) {
			await writeBatteryRuntimePersist(
				host.getAbsolutePath("learning/battery_runtime"),
				result,
				lastRun,
			);
		}

		await writeResult(host, result, lastRun);

		host.log.info(
			`Battery-Runtime-Learning: status=${result.status} nights=${result.avgNightDischargePct ?? "n/a"}% samples=${result.sampleDays} soc=${sourceLabelFromStateId(sources.socStateId)}`,
		);

		if (result.status === "insufficient_data") {
			host.log.warn(
				`Battery Runtime Learning: ungenügende Historie (sample_days=${result.sampleDays}, soc_points=${socHist.points.length})`,
			);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		host.log.error(`Battery Runtime Learning: ${msg}`);
		await writeResult(
			host,
			errorResult(msg, cfg, { soc: sources.socStateId, power: sources.powerStateId }),
			lastRun,
		);
	}
}
