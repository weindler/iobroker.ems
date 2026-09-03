/**
 * Climate-Thermal-Learning: Rebuild aus Day-Telemetry (90 Tage).
 * Schreibt nur eigene Persistenz/States — kein Einfluss auf Planung oder Runtime.
 */

import { AC_UNIT_COUNT } from "../../addons/air_conditioning/constants";
import { acUnitConfigFromAdapter, availableAcModePurposes } from "../../addons/air_conditioning/config";
import type { StateHost } from "../../ems_light/state_util";
import { addDaysToDateKey, localDateKeyInTimezone } from "../../operator/time";
import { DAY_TELEMETRY_CATEGORY, DAY_TELEMETRY_RETENTION_DAYS } from "../day_telemetry/constants";
import { listDayTelemetryDateKeys, readDayTelemetryDay } from "../day_telemetry/persist";
import { computeClimateThermalModels, type ClimateThermalUnitAvailability } from "./math";
import {
	ensureClimateThermalRootStates,
	ensureClimateThermalStatesForUnit,
	publishClimateThermalUnit,
} from "./ensure_states";
import { readClimateThermalPersist, writeClimateThermalPersist } from "./persist";
import type { ClimateThermalPersist } from "./types";

export const CLIMATE_THERMAL_PERSIST_CATEGORY = "learning/climate_thermal";

export type ClimateThermalHost = StateHost & {
	getAbsolutePath: (category?: string) => string;
	config?: unknown;
	log?: { warn?: (m: string) => void; debug?: (m: string) => void; error?: (m: string) => void };
};

function timezoneFromConfig(config: unknown): string {
	const tz =
		typeof (config as Record<string, unknown>)?.timezone === "string"
			? ((config as Record<string, unknown>).timezone as string).trim()
			: "";
	return tz || "Europe/Berlin";
}

function availabilityFromConfig(config: unknown): ClimateThermalUnitAvailability[] {
	const units: ClimateThermalUnitAvailability[] = [];
	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		const cfg = acUnitConfigFromAdapter(config, i);
		units.push({
			unitIndex: i,
			enabled: cfg.enabled,
			modesAvailable: availableAcModePurposes(cfg),
		});
	}
	return units;
}

export async function runClimateThermalLearning(
	host: ClimateThermalHost,
	opts: { now?: Date } = {},
): Promise<ClimateThermalPersist> {
	const now = opts.now ?? new Date();
	const nowMs = now.getTime();
	const timezone = timezoneFromConfig(host.config);
	const todayKey = localDateKeyInTimezone(now, timezone);
	const cutoffKey = addDaysToDateKey(todayKey, -(DAY_TELEMETRY_RETENTION_DAYS - 1));
	const telemetryDir = host.getAbsolutePath(DAY_TELEMETRY_CATEGORY);
	const persistDir = host.getAbsolutePath(CLIMATE_THERMAL_PERSIST_CATEGORY);

	let units: ClimateThermalPersist["units"] = {};
	try {
		const allKeys = (await listDayTelemetryDateKeys(telemetryDir)).filter(
			(k) => k >= cutoffKey && k <= todayKey,
		);
		const days = [];
		for (const dateKey of allKeys) {
			const day = await readDayTelemetryDay(telemetryDir, dateKey);
			if (day) days.push(day);
		}
		units = computeClimateThermalModels(days, availabilityFromConfig(host.config), nowMs);
	} catch (e) {
		host.log?.warn?.(
			`climate_thermal: Learning-Lauf fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
		);
		return readClimateThermalPersist(persistDir);
	}

	const persisted = await writeClimateThermalPersist(persistDir, units);
	try {
		await ensureClimateThermalRootStates(host);
		const models = Object.values(units);
		const usable = models.filter(
			(m) => m.passive.usable || m.cooling.usable || m.heating.usable || m.dehumidify.humidity.usable,
		).length;
		await host.setStateAsync("learning.climate_thermal.units_count", { val: models.length, ack: true });
		await host.setStateAsync("learning.climate_thermal.last_run", {
			val: persisted.generatedAtIso,
			ack: true,
		});
		await host.setStateAsync("learning.climate_thermal.summary_de", {
			val:
				models.length === 0
					? "Noch keine Climate-Thermal-Daten."
					: `${models.length} Unit(s), ${usable} mit usable Modell — nur Diagnose, keine Steuerung.`,
			ack: true,
		});
	} catch (e) {
		host.log?.warn?.(`climate_thermal: Root-States: ${e instanceof Error ? e.message : String(e)}`);
	}

	for (const model of Object.values(units)) {
		try {
			await ensureClimateThermalStatesForUnit(host, model.unitIndex);
			await publishClimateThermalUnit(host, model);
		} catch (e) {
			host.log?.warn?.(
				`climate_thermal: State-Publish unit_${model.unitIndex}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}

	return persisted;
}

export async function loadClimateThermalPersist(
	host: Pick<ClimateThermalHost, "getAbsolutePath">,
): Promise<ClimateThermalPersist> {
	return readClimateThermalPersist(host.getAbsolutePath(CLIMATE_THERMAL_PERSIST_CATEGORY));
}
