import { asNum } from "../../ems_light/state_util";
import { pvBiasConfigFromAdapter, pvBiasConfigReady } from "./config";
import { FROZEN_TODAY_STATE_ID, readFrozenForecast, runForecastFreeze } from "./freeze";
import { fetchPvBiasDayPairs, readStateNum } from "./history";
import { computePvBias } from "./math";
import type { HistoryQueryHost } from "../history_query";
import type { PvBiasComputeResult } from "./types";

export type PvBiasRunHost = HistoryQueryHost & {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
};

async function readForeignNum(host: PvBiasRunHost, stateId: string): Promise<number | null> {
	return readStateNum(host, stateId);
}

async function readLiveRawForecast(
	host: PvBiasRunHost,
	configStateId: string,
	fallbackLocalId: string,
): Promise<number | null> {
	const fromConfig = await readForeignNum(host, configStateId);
	if (fromConfig !== null) {
		return fromConfig;
	}
	const local = await host.getStateAsync(fallbackLocalId);
	return asNum(local?.val);
}

async function setNumIfValid(host: PvBiasRunHost, id: string, value: number | null): Promise<void> {
	if (value !== null && Number.isFinite(value)) {
		await host.setStateAsync(id, { val: Math.round(value * 1000) / 1000, ack: true });
	}
}

async function writePvBiasResult(host: PvBiasRunHost, result: PvBiasComputeResult): Promise<void> {
	await setNumIfValid(host, "learning.pv_bias.bias_today_pct", result.biasTodayPct);
	await setNumIfValid(host, "learning.pv_bias.bias_7d_pct", result.bias7dPct);
	await setNumIfValid(host, "learning.pv_bias.bias_30d_pct", result.bias30dPct);
	await setNumIfValid(host, "learning.pv_bias.corrected_today_kwh", result.correctedTodayKwh);
	await setNumIfValid(host, "learning.pv_bias.corrected_tomorrow_kwh", result.correctedTomorrowKwh);
	await setNumIfValid(host, "learning.pv_bias.confidence_pct", result.confidencePct);
	await setNumIfValid(host, "learning.pv_bias.raw_today_kwh", result.rawTodayKwh);
	await setNumIfValid(host, "learning.pv_bias.raw_tomorrow_kwh", result.rawTomorrowKwh);
	await setNumIfValid(host, "learning.pv_bias.sample_days_7d", result.sampleDays7d);
	await setNumIfValid(host, "learning.pv_bias.sample_days_30d", result.sampleDays30d);
	await host.setStateAsync("learning.pv_bias.last_update_ts", {
		val: new Date().toISOString(),
		ack: true,
	});
	await host.setStateAsync("learning.pv_bias.status", { val: result.status, ack: true });
	await host.setStateAsync("learning.pv_bias.reason", { val: result.reason, ack: true });
}

export async function runPvBiasLearning(host: PvBiasRunHost): Promise<void> {
	const cfg = pvBiasConfigFromAdapter(host.config);

	if (!cfg.enabled) {
		await host.setStateAsync("learning.pv_bias.status", { val: "disabled", ack: true });
		await host.setStateAsync("learning.pv_bias.reason", {
			val: "PV-Bias Learning in Admin deaktiviert.",
			ack: true,
		});
		return;
	}

	if (!pvBiasConfigReady(cfg)) {
		await host.setStateAsync("learning.pv_bias.status", { val: "no_config", ack: true });
		await host.setStateAsync("learning.pv_bias.reason", {
			val: cfg.freezeEnabled
				? "Historie-State für PV-Ist und gültige Freeze-Zeit in Admin konfigurieren."
				: "Historie-States für PV-Ist und PV-Forecast in Admin konfigurieren.",
			ack: true,
		});
		return;
	}

	try {
		await runForecastFreeze(host, cfg);

		const forecastHistoryStateId = cfg.freezeEnabled
			? FROZEN_TODAY_STATE_ID
			: cfg.historyForecastStateId;

		host.log.info("PV-Bias: loading history (max 30 days, timeout per query)…");
		const pairs = await fetchPvBiasDayPairs(
			host,
			cfg.historyActualStateId,
			forecastHistoryStateId,
		);
		host.log.info(`PV-Bias: history loaded, ${pairs.length} valid day pair(s)`);
		if (pairs.length === 0) {
			const todayActual = await readStateNum(host, cfg.historyActualStateId);
			const todayForecast = await readStateNum(host, forecastHistoryStateId);
			host.log.warn(
				`PV-Bias: no pairs — today live actual=${todayActual ?? "—"} forecast=${todayForecast ?? "—"} (Historie am Alias + frozen_today_kwh empfohlen)`,
			);
		}

		const rawTodayKwh = await readLiveRawForecast(
			host,
			cfg.rawTodayStateId,
			"forecast.pv.today_kwh",
		);
		const rawTomorrowKwh = await readLiveRawForecast(
			host,
			cfg.rawTomorrowStateId,
			"forecast.pv.tomorrow_kwh",
		);

		const frozen = cfg.freezeEnabled ? await readFrozenForecast(host) : { today: null, tomorrow: null };
		const forecastForCorrection = cfg.freezeEnabled
			? { today: frozen.today, tomorrow: frozen.tomorrow }
			: { today: rawTodayKwh, tomorrow: rawTomorrowKwh };

		const result = computePvBias(pairs, forecastForCorrection.today, forecastForCorrection.tomorrow);
		result.rawTodayKwh = rawTodayKwh;
		result.rawTomorrowKwh = rawTomorrowKwh;
		if (cfg.freezeEnabled && frozen.today === null) {
			result.status = "insufficient_data";
			result.reason = "Eingefrorener Forecast fehlt — Bias/Korrektur warten auf Freeze-Snapshot.";
		}

		await writePvBiasResult(host, result);
		host.log.info(
			`PV-Bias: 7d=${result.bias7dPct ?? "—"}% 30d=${result.bias30dPct ?? "—"}% conf=${result.confidencePct}% samples=${result.sampleDays30d} freeze=${cfg.freezeEnabled}`,
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		host.log.error(`PV-Bias Learning: ${msg}`);
		await host.setStateAsync("learning.pv_bias.status", { val: "error", ack: true });
		await host.setStateAsync("learning.pv_bias.reason", {
			val: `Fehler bei PV-Bias-Berechnung: ${msg}`,
			ack: true,
		});
	}
}
