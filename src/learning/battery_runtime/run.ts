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
	fetchSocHistoryRaw,
	mergeDailyAstroTimes,
	readLiveCapacityKwh,
	readLiveSoc,
	readSecondsSinceFullCharge,
} from "./history";
import { resolveBatteryRuntimeSources } from "./mapping";
import {
	computeBatteryRuntimeLearning,
	disabledResult,
	errorResult,
	noSourceResult,
	withPowerDiagnostics,
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
	await setNumIfValid(host, "learning.battery_runtime.seconds_since_full_charge", result.secondsSinceFullCharge);
	await host.setStateAsync("learning.battery_runtime.full_charge_source", {
		val: result.fullChargeSource ?? "",
		ack: true,
	});
	await setNumIfValid(host, "learning.battery_runtime.topoff_interval_days", result.topoffIntervalDays);
	await setNumIfValid(host, "learning.battery_runtime.topoff_days_remaining", result.topoffDaysRemaining);
	if (result.topoffDue !== null) {
		await host.setStateAsync("learning.battery_runtime.topoff_due", {
			val: result.topoffDue ? 1 : 0,
			ack: true,
		});
	}
	await setNumIfValid(host, "learning.battery_runtime.estimated_runtime_days", result.estimatedRuntimeDays);
	await setNumIfValid(host, "learning.battery_runtime.power_history_raw_rows", result.powerHistoryRawRows);
	await setNumIfValid(
		host,
		"learning.battery_runtime.power_history_normalized_rows",
		result.powerHistoryNormalizedRows,
	);
	await setNumIfValid(host, "learning.battery_runtime.power_raw_charge_samples", result.powerRawChargeSamples);
	await setNumIfValid(
		host,
		"learning.battery_runtime.power_raw_discharge_samples",
		result.powerRawDischargeSamples,
	);
	await setNumIfValid(host, "learning.battery_runtime.power_hourly_charge_points", result.powerHourlyChargePoints);
	await setNumIfValid(
		host,
		"learning.battery_runtime.power_hourly_discharge_points",
		result.powerHourlyDischargePoints,
	);
	if (result.powerInvertApplied !== null) {
		await host.setStateAsync("learning.battery_runtime.power_invert_applied", {
			val: result.powerInvertApplied ? 1 : 0,
			ack: true,
		});
	}
	if (result.powerInvertAuto !== null) {
		await host.setStateAsync("learning.battery_runtime.power_invert_auto", {
			val: result.powerInvertAuto ? 1 : 0,
			ack: true,
		});
	}
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
		secondsSinceFullStateId: cfg.secondsSinceFullStateId,
	});

	if (!sources.socStateId) {
		await writeResult(host, noSourceResult(cfg), lastRun);
		return;
	}

	try {
		host.log.info(
			`Battery-Runtime-Learning: loading history (${cfg.lookbackDays}d, soc=${sourceLabelFromStateId(sources.socStateId)})…`,
		);
		const [socHist, secondsSinceFull, capacityKwh, currentSocPct] = await Promise.all([
			fetchSocHistory(host, sources.socStateId, cfg.lookbackDays),
			readSecondsSinceFullCharge(host, sources.secondsSinceFullStateId),
			readLiveCapacityKwh(host, sources.capacityStateId),
			readLiveSoc(host, sources.socStateId),
		]);
		const socRaw =
			secondsSinceFull === null
				? await fetchSocHistoryRaw(host, sources.socStateId, cfg.lookbackDays)
				: [];
		const powerHist = sources.powerStateId
			? await fetchPowerHistory(host, sources.powerStateId, cfg.lookbackDays, cfg.powerInvert)
			: { points: [], lastValidTs: null, meta: null };
		const astroDaily = nightAstroConfigReady(cfg)
			? mergeDailyAstroTimes(
					await fetchAstroTimeHistory(host, cfg.nightStartStateId, cfg.lookbackDays),
					await fetchAstroTimeHistory(host, cfg.nightEndStateId, cfg.lookbackDays),
				)
			: null;

		const sampleDays = distinctSocSampleDays(socHist.points);
		const result = withPowerDiagnostics(
			computeBatteryRuntimeLearning({
				socPoints: socHist.points,
				socPointsForFullCharge: socRaw,
				secondsSinceFull,
				powerPoints: powerHist.points,
				capacityKwh,
				currentSocPct,
				cfg,
				sourceSocStateId: sources.socStateId,
				sourcePowerStateId: sources.powerStateId,
				now,
				sampleDays,
				astroDaily,
			}),
			powerHist.meta,
		);

		if (host.getAbsolutePath) {
			await writeBatteryRuntimePersist(
				host.getAbsolutePath("learning/battery_runtime"),
				result,
				lastRun,
			);
		}

		await writeResult(host, result, lastRun);

		host.log.info(
			`Battery-Runtime-Learning: status=${result.status} nights=${result.avgNightDischargePct ?? "n/a"}% samples=${result.sampleDays} full_src=${result.fullChargeSource ?? "—"} sec_since_full=${result.secondsSinceFullCharge ?? "—"} days_since_full=${result.daysSinceFull ?? "—"} last_full=${result.lastFullCharge ?? "—"} soc=${sourceLabelFromStateId(sources.socStateId)} power=${sourceLabelFromStateId(sources.powerStateId)} invert=${result.powerInvertApplied === null ? "—" : result.powerInvertApplied ? "on" : "off"}${result.powerInvertAuto ? "(auto)" : ""} pwr_raw=${result.powerRawChargeSamples ?? "—"}/${result.powerRawDischargeSamples ?? "—"} pwr_hr=${result.powerHourlyChargePoints ?? "—"}/${result.powerHourlyDischargePoints ?? "—"} avg_chg_w=${result.avgChargePowerW ?? "—"}`,
		);

		if (
			sources.powerStateId &&
			result.powerRawChargeSamples === 0 &&
			result.powerRawDischargeSamples !== null &&
			result.powerRawDischargeSamples > 0
		) {
			host.log.warn(
				`Battery Runtime Learning: keine Lade-Samples in Leistungs-History (raw_charge=0, raw_discharge=${result.powerRawDischargeSamples}, invert=${result.powerInvertApplied ? "on" : "off"}${result.powerInvertAuto ? " auto" : ""}) — pacTotal-History prüfen (negative Werte beim Laden?)`,
			);
		}

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
