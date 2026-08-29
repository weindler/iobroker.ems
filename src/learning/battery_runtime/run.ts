import {
	batteryRuntimeConfigFromAdapter,
	nightAstroConfigReady,
	sourceLabelFromStateId,
} from "./config";
import {
	fetchAstroTimeHistory,
	fetchPowerHistory,
	fetchSitePowerFromEnergyCounter,
	fetchSitePowerSeries,
	fetchSocHistory,
	fetchSocHistoryRaw,
	mergeDailyAstroTimes,
	MIN_NIGHT_BRIDGE_SITE_POINTS,
	readLiveCapacityKwh,
	readLiveSoc,
	readSecondsSinceFullCharge,
	distinctSocSampleDays,
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
import { pvBiasConfigFromAdapter } from "../pv_bias/config";

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
	log: { info: (msg: string) => void;
		debug?: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
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
	diag?: { pvPoints: number; housePoints: number; pvOrigin?: string },
): Promise<void> {
	await host.setStateAsync("learning.battery_runtime.status", { val: result.status, ack: true });
	await host.setStateAsync("learning.battery_runtime.last_run", { val: lastRun, ack: true });
	await setNumIfValid(host, "learning.battery_runtime.sample_days", result.sampleDays);
	await setNumIfValid(host, "learning.battery_runtime.avg_night_discharge_kwh", result.avgNightDischargeKwh);
	// avg_night_discharge_pct: Surface-Cleanup löscht den State als Ballast — nicht mehr schreiben (Wert in Persist/Log).
	await setNumIfValid(host, "learning.battery_runtime.avg_night_bridge_hours", result.avgNightBridgeHours);
	await setNumIfValid(
		host,
		"learning.battery_runtime.predicted_night_consumption_kwh",
		result.predictedNightConsumptionKwh,
	);
	await setNumIfValid(
		host,
		"learning.battery_runtime.night_consumption_valid_nights",
		result.nightConsumptionValidNights,
	);
	await setNumIfValid(
		host,
		"learning.battery_runtime.predicted_night_grid_import_kwh",
		result.predictedNightGridImportKwh,
	);
	await setNumIfValid(host, "learning.battery_runtime.avg_night_load_w", result.avgNightLoadW);
	await setNumIfValid(
		host,
		"learning.battery_runtime.required_soc_at_pv_end_pct",
		result.requiredSocAtPvEndPct,
	);
	await setNumIfValid(
		host,
		"learning.battery_runtime.required_night_reserve_kwh",
		result.requiredNightReserveKwh,
	);
	await host.setStateAsync("learning.battery_runtime.night_reserve_reason_de", {
		val: result.nightReserveReasonDe,
		ack: true,
	});
	await host.setStateAsync("learning.battery_runtime.night_bridge_method", {
		val: result.nightBridgeMethod,
		ack: true,
	});
	if (diag) {
		await setNumIfValid(host, "learning.battery_runtime.night_bridge_pv_points", diag.pvPoints);
		await setNumIfValid(host, "learning.battery_runtime.night_bridge_house_points", diag.housePoints);
		if (diag.pvOrigin) {
			await host.setStateAsync("learning.battery_runtime.night_bridge_pv_origin", {
				val: diag.pvOrigin,
				ack: true,
			});
		}
	}
	await setNumIfValid(
		host,
		"learning.battery_runtime.night_bridge_valid_nights",
		result.nightBridgeValidNights,
	);
	await setNumIfValid(host, "learning.battery_runtime.avg_charge_power_w", result.avgChargePowerW);
	await setNumIfValid(host, "learning.battery_runtime.max_charge_power_w", result.maxChargePowerW);
	await host.setStateAsync("learning.battery_runtime.last_full_charge", {
		val: result.lastFullCharge ?? "",
		ack: true,
	});
	await setNumIfValid(host, "learning.battery_runtime.days_since_full", result.daysSinceFull);
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
		secondsSinceFullStateId: cfg.secondsSinceFullStateId,
	});

	if (!sources.socStateId) {
		await writeResult(host, noSourceResult(cfg), lastRun);
		return;
	}

	try {
		host.log.debug?.(
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
		const [pvDirect, housePowerPoints] = await Promise.all([
			sources.pvAcPowerStateId
				? fetchSitePowerSeries(host, sources.pvAcPowerStateId, cfg.lookbackDays)
				: Promise.resolve([] as { ts: number; powerW: number }[]),
			sources.consumptionStateId
				? fetchSitePowerSeries(host, sources.consumptionStateId, cfg.lookbackDays)
				: Promise.resolve([] as { ts: number; powerW: number }[]),
		]);
		let pvPowerPoints = pvDirect;
		let pvOrigin =
			pvDirect.length >= MIN_NIGHT_BRIDGE_SITE_POINTS
				? "pv_ac"
				: pvDirect.length > 0
					? "pv_ac_thin"
					: "none";
		if (pvPowerPoints.length < MIN_NIGHT_BRIDGE_SITE_POINTS) {
			const energyId = pvBiasConfigFromAdapter(host.config).historyActualStateId;
			if (energyId) {
				const fromEnergy = await fetchSitePowerFromEnergyCounter(
					host,
					energyId,
					cfg.lookbackDays,
				);
				if (fromEnergy.length > pvPowerPoints.length) {
					pvPowerPoints = fromEnergy;
					pvOrigin = "day_energy";
					host.log.info(
						`Battery-Runtime-Learning: PV-AC-Historie dünn (${pvDirect.length}) — Leistung aus Energiezähler ${sourceLabelFromStateId(energyId)} (${fromEnergy.length} Punkte).`,
					);
				}
			}
		}
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
				pvPowerPoints,
				housePowerPoints,
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

		await writeResult(host, result, lastRun, {
			pvPoints: pvPowerPoints.length,
			housePoints: housePowerPoints.length,
			pvOrigin,
		});

		host.log.info(
			`Battery-Runtime-Learning: status=${result.status} method=${result.nightBridgeMethod} validNights=${result.nightBridgeValidNights} nights=${result.avgNightDischargePct ?? "n/a"}% kwh=${result.avgNightDischargeKwh ?? "n/a"} bridgeH=${result.avgNightBridgeHours ?? "n/a"} samples=${result.sampleDays} pvPts=${pvPowerPoints.length} housePts=${housePowerPoints.length} pvOrigin=${pvOrigin} pvSrc=${sourceLabelFromStateId(sources.pvAcPowerStateId)} houseSrc=${sourceLabelFromStateId(sources.consumptionStateId)}`,
		);
		host.log.debug?.(
			`Battery-Runtime-Learning detail: full_src=${result.fullChargeSource ?? "—"} sec_since_full=${result.secondsSinceFullCharge ?? "—"} days_since_full=${result.daysSinceFull ?? "—"} soc=${sourceLabelFromStateId(sources.socStateId)} power=${sourceLabelFromStateId(sources.powerStateId)} invert=${result.powerInvertApplied === null ? "—" : result.powerInvertApplied ? "on" : "off"}${result.powerInvertAuto ? "(auto)" : ""}`,
		);

		if (
			result.nightBridgeMethod !== "pv_house" &&
			(!sources.pvAcPowerStateId || !sources.consumptionStateId)
		) {
			host.log.warn(
				`Battery-Runtime-Learning: PV/Hauslast-Nachtbrücke nicht möglich — Mapping fehlt (pv=${sources.pvAcPowerStateId || "—"}; house=${sources.consumptionStateId || "—"}). Fallback=${result.nightBridgeMethod}.`,
			);
		} else if (result.nightBridgeMethod !== "pv_house" && (pvPowerPoints.length < 24 || housePowerPoints.length < 24)) {
			host.log.warn(
				`Battery-Runtime-Learning: PV/Hauslast-Historie zu dünn für Nachtbrücke (pv=${pvPowerPoints.length}, house=${housePowerPoints.length}) — Fallback=${result.nightBridgeMethod}. Power-Rollup/History für bat_pv_ac / consumption prüfen.`,
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
