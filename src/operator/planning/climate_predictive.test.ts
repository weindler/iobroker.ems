import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acUnitConfigFromAdapter } from "../../addons/air_conditioning/config";
import {
	emptyEffectStat,
	emptyPassiveStat,
	type ClimateThermalUnitModel,
} from "../../learning/climate_thermal/types";
import type { WeatherHourlyPoint } from "../contributions/weather";
import { planCooling } from "./cooling";
import { estimateClimateUnitDemand } from "./climate_predictive";

const NOW = new Date("2026-07-05T10:00:00.000Z");

function hourly(temps: Array<number | null>, from = NOW): WeatherHourlyPoint[] {
	return temps.map((t, i) => {
		const start = new Date(from.getTime() + i * 3_600_000);
		return {
			startIso: start.toISOString(),
			endIso: new Date(start.getTime() + 3_600_000).toISOString(),
			outdoorTempC: t,
			cloudPct: null,
		};
	});
}

function unit(over: Record<string, unknown> = {}, index = 1) {
	return acUnitConfigFromAdapter(
		{
			[`ac_u${index}_enabled`]: true,
			[`ac_u${index}_on_temp_c`]: 26,
			[`ac_u${index}_off_temp_c`]: 24,
			[`ac_u${index}_estimated_power_w`]: 900,
			[`ac_u${index}_active_from`]: "00:00",
			[`ac_u${index}_active_until`]: "20:00",
			[`ac_u${index}_hard_off_at`]: "20:00",
			[`ac_u${index}_mode_when_cooling`]: "cool",
			[`ac_u${index}_mode_when_heating`]: "",
			[`ac_u${index}_mode_when_dehumidify`]: "dry",
			[`ac_u${index}_max_humidity_pct`]: 60,
			...over,
		},
		index,
	);
}

function usableStat(rate: number) {
	return {
		...emptyEffectStat("ok", "usable"),
		sampleCount: 12,
		rate,
		confidence: 0.72,
		usable: true,
	};
}

function unusableStat(rate: number | null = 0.4) {
	return {
		...emptyEffectStat("ok", "noch nicht usable"),
		sampleCount: 3,
		rate,
		confidence: 0.2,
		usable: false,
	};
}

function thermal(over: Partial<ClimateThermalUnitModel> = {}): ClimateThermalUnitModel {
	return {
		unitIndex: 1,
		passive: {
			...emptyPassiveStat("ok", "usable"),
			sampleCount: 12,
			rate: 0.45,
			warmingRateKPerH: 0.5,
			coolingRateKPerH: -0.15,
			confidence: 0.7,
			usable: true,
		},
		cooling: usableStat(-1.1),
		heating: usableStat(0.9),
		dehumidify: { temp: usableStat(-0.2), humidity: usableStat(-4) },
		inertia: emptyEffectStat("not_evaluable", "kein Inertia"),
		reasonDe: "usable",
		lastRunIso: NOW.toISOString(),
		...over,
	};
}

function demand(over: Partial<Parameters<typeof estimateClimateUnitDemand>[0]> = {}) {
	const u = over.unit ?? unit();
	return estimateClimateUnitDemand({
		now: NOW,
		unit: u,
		roomTempC: 24,
		roomHumidityPct: 45,
		outdoorTempC: 22,
		outdoorForecastMaxC: 30,
		outdoorLikelyTempC: 28,
		remainingHours: 8,
		windowEndMs: NOW.getTime() + 8 * 3_600_000,
		hourlyPoints: [],
		thermal: null,
		learnedHours: null,
		...over,
	});
}

describe("climate_predictive — Neuinstallation / Bootstrap", () => {
	it("frische Installation ohne Learning-Datei: Cooling bei aktueller Verletzung", () => {
		const r = demand({ roomTempC: 27.5, thermal: null, hourlyPoints: [] });
		assert.equal(r.demandModel, "bootstrap");
		assert.equal(r.cooling.likelyActive, true);
		assert.ok(r.cooling.expectedHours >= 0.25);
	});

	it("neue Unit ohne Historie: milder Raum + Tagesmax erzeugt kein Cooling-Budget", () => {
		const r = demand({
			roomTempC: 22,
			outdoorForecastMaxC: 34,
			outdoorTempC: 18,
			hourlyPoints: [],
			thermal: undefined,
		});
		assert.equal(r.demandModel, "bootstrap");
		assert.equal(r.cooling.likelyActive, false);
		assert.equal(r.cooling.expectedHours, 0);
	});

	it("leere Thermal-Struktur bleibt Bootstrap, keine erfundenen K/h", () => {
		const empty: ClimateThermalUnitModel = {
			unitIndex: 1,
			passive: emptyPassiveStat("not_evaluable", "leer"),
			cooling: emptyEffectStat("not_evaluable", "leer"),
			heating: emptyEffectStat("unavailable", "Heating aus"),
			dehumidify: {
				temp: emptyEffectStat("not_evaluable", "leer"),
				humidity: emptyEffectStat("not_evaluable", "leer"),
			},
			inertia: emptyEffectStat("not_evaluable", "leer"),
			reasonDe: "leer",
			lastRunIso: null,
		};
		const r = demand({ roomTempC: 22, thermal: empty, outdoorForecastMaxC: 35 });
		assert.equal(r.demandModel, "bootstrap");
		assert.equal(r.cooling.likelyActive, false);
		assert.match(r.fallbackReasonDe ?? "", /Bootstrap|Learning/i);
	});

	it("Learning vorhanden aber usable=false: Bootstrap, halb-gelernte Rate nicht genutzt", () => {
		const r = demand({
			roomTempC: 22,
			hourlyPoints: hourly([32, 33, 34, 34, 33, 32, 30, 28]),
			thermal: thermal({
				passive: { ...unusableStat(0.8), warmingRateKPerH: 2, coolingRateKPerH: -1 },
				cooling: unusableStat(-3),
			}),
		});
		assert.equal(r.demandModel, "bootstrap");
		assert.equal(r.cooling.likelyActive, false);
		assert.ok(!(r.fallbackReasonDe ?? "").includes("K/h"));
	});

	it("Adapter-Restart ohne Learning: Cooling/Heating/Dry wie Neuinstallation", () => {
		const r = demand({ thermal: null, roomTempC: 28, roomHumidityPct: 70 });
		assert.equal(r.demandModel, "bootstrap");
		assert.equal(r.cooling.likelyActive, true);
		assert.equal(r.dehumidify.likelyActive, true);
	});

	it("Raum näher an on-Grenze + heißer Stundenforecast → vorsichtiges Pre-Cooling", () => {
		const r = demand({
			roomTempC: 25.2,
			hourlyPoints: hourly([29, 30, 32, 33, 34, 33, 31, 29]),
			outdoorTempC: 24,
		});
		assert.equal(r.demandModel, "bootstrap");
		assert.equal(r.cooling.likelyActive, true);
		assert.ok(r.cooling.expectedHours > 0);
		assert.ok(r.cooling.expectedHours < 6);
		assert.match(r.cooling.reasonDe, /Pre-Cooling/);
	});

	it("fehlender hourly Forecast: Bootstrap ohne Pre-Cool, aktueller Bedarf bleibt", () => {
		const cool = demand({ roomTempC: 27, hourlyPoints: [] });
		assert.equal(cool.demandModel, "bootstrap");
		assert.equal(cool.cooling.likelyActive, true);

		const mild = demand({ roomTempC: 25.2, hourlyPoints: [], outdoorTempC: 20 });
		assert.equal(mild.cooling.likelyActive, false);
	});
});

describe("climate_predictive — Heating / Dry ohne Learning", () => {
	it("Heating enabled + kalter Raum: Bedarf ohne Learning", () => {
		const r = demand({
			unit: unit({ ac_u1_mode_when_heating: "heat", ac_u1_heat_setpoint_c: 20 }),
			roomTempC: 17.5,
			thermal: null,
		});
		assert.equal(r.demandModel, "bootstrap");
		assert.equal(r.heating.likelyActive, true);
		assert.ok(r.heating.expectedHours >= 0.25);
	});

	it("Heating enabled + Raum deutlich über Soll: kein Heizbedarf", () => {
		const r = demand({
			unit: unit({ ac_u1_mode_when_heating: "heat", ac_u1_heat_setpoint_c: 20 }),
			roomTempC: 23,
			thermal: null,
		});
		assert.equal(r.heating.likelyActive, false);
	});

	it("Heating disabled: niemals Climate-Heizbedarf", () => {
		const r = demand({
			unit: unit({ ac_u1_mode_when_heating: "" }),
			roomTempC: 12,
			thermal: null,
		});
		assert.equal(r.heating.likelyActive, false);
		assert.equal(r.heating.expectedHours, 0);
		assert.match(r.heating.reasonDe, /nicht verfügbar/);
	});

	it("Heating ohne Sollwert: kein erfundener Bedarf", () => {
		const r = demand({
			unit: unit({ ac_u1_mode_when_heating: "heat" }),
			roomTempC: 16,
			thermal: null,
		});
		assert.equal(r.heating.likelyActive, false);
		assert.match(r.heating.reasonDe, /Sollwert/);
	});

	it("Dry: aktuelle Feuchte über max ohne Learning → Bedarf", () => {
		const r = demand({ roomHumidityPct: 68, roomTempC: 23, thermal: null });
		assert.equal(r.dehumidify.likelyActive, true);
		assert.ok(r.dehumidify.expectedHours > 0);
	});

	it("Dry: Feuchte unter Grenze → kein learnedHours-Budget", () => {
		const r = demand({
			roomHumidityPct: 48,
			roomTempC: 23,
			learnedHours: 5,
			thermal: null,
			outdoorForecastMaxC: 34,
		});
		assert.equal(r.dehumidify.likelyActive, false);
		assert.equal(r.dehumidify.expectedHours, 0);
	});

	it("Dry: Feuchte fehlt → kein Crash, kein erfundenes Dry aus Außenmax", () => {
		const r = demand({ roomHumidityPct: null, roomTempC: 23, outdoorForecastMaxC: 34 });
		assert.equal(r.dehumidify.likelyActive, false);
	});
});

describe("climate_predictive — Predictive / Fallback", () => {
	it("Learning usable + Sensoren + hourly → predictive Cooling", () => {
		const r = demand({
			roomTempC: 24.2,
			hourlyPoints: hourly([30, 31, 32, 33, 34, 33, 32, 30]),
			thermal: thermal(),
		});
		assert.equal(r.demandModel, "predictive");
		assert.ok(r.predictiveConfidence != null && r.predictiveConfidence >= 0.45);
		assert.equal(r.cooling.likelyActive, true);
		assert.ok(r.cooling.predictedPeak != null);
	});

	it("Learning verliert usable → automatisch Bootstrap", () => {
		const usable = demand({
			roomTempC: 24.2,
			hourlyPoints: hourly([30, 31, 32, 33, 34, 33, 32, 30]),
			thermal: thermal(),
		});
		assert.equal(usable.demandModel, "predictive");

		const lost = demand({
			roomTempC: 24.2,
			hourlyPoints: hourly([30, 31, 32, 33, 34, 33, 32, 30]),
			thermal: thermal({
				passive: { ...unusableStat(0.45), warmingRateKPerH: 0.5, coolingRateKPerH: -0.1 },
				cooling: unusableStat(-1),
			}),
		});
		assert.equal(lost.demandModel, "bootstrap");
	});

	it("fehlende Raumtemperatur → legacy_fallback, kein Crash", () => {
		const r = demand({ roomTempC: null, outdoorForecastMaxC: 32, outdoorTempC: 31 });
		assert.equal(r.demandModel, "legacy_fallback");
		assert.equal(r.cooling.likelyActive, true);
	});

	it("keine Climate-Modi verfügbar → kein Bedarf", () => {
		const r = demand({
			unit: unit({
				ac_u1_mode_when_cooling: "",
				ac_u1_mode_when_heating: "",
				ac_u1_mode_when_dehumidify: "",
			}),
			roomTempC: 30,
			roomHumidityPct: 80,
		});
		assert.equal(r.demandModel, "legacy_fallback");
		assert.equal(r.cooling.likelyActive, false);
		assert.equal(r.heating.likelyActive, false);
		assert.equal(r.dehumidify.likelyActive, false);
	});

	it("Heating predictive wenn usable; Dry predictive nur bei usable Feuchte-Learning", () => {
		const heat = demand({
			unit: unit({ ac_u1_mode_when_heating: "heat", ac_u1_heat_setpoint_c: 20 }),
			roomTempC: 19,
			hourlyPoints: hourly([8, 7, 6, 5, 6, 8, 10, 12]),
			thermal: thermal(),
		});
		assert.equal(heat.demandModel, "predictive");
		assert.equal(heat.heating.likelyActive, true);

		const dryPred = demand({
			roomHumidityPct: 66,
			hourlyPoints: hourly([20, 21, 22, 22, 21, 20, 19, 18]),
			thermal: thermal(),
		});
		assert.ok(dryPred.dehumidify.likelyActive);
		assert.match(dryPred.dehumidify.reasonDe, /Predictive Dry|aktueller Dry/);
	});
});

describe("planCooling — Reifestufen verdrahtet", () => {
	it("Shared-Power zwei Units mit aktuellem Bedarf bleibt Peak-max()", () => {
		const u1 = unit({ ac_u1_estimated_power_w: 800, ac_u1_shared_power_group_id: "outdoor_1" }, 1);
		const u2 = unit(
			{
				ac_u2_enabled: true,
				ac_u2_on_temp_c: 24.5,
				ac_u2_off_temp_c: 23,
				ac_u2_estimated_power_w: 650,
				ac_u2_shared_power_group_id: "outdoor_1",
			},
			2,
		);
		const result = planCooling({
			now: new Date("2026-07-05T10:00:00"),
			acConfig: {
				outdoorMaxPowerW: 5000,
				plannerOutdoorLikelyTempC: 28,
				defaultProfileId: "generic",
				units: [u1, u2],
			},
			governanceEnabled: true,
			outdoorTempC: null,
			units: [
				{ unit: u1, roomTempC: 27, consumerStats: undefined },
				{ unit: u2, roomTempC: 26, consumerStats: undefined },
			],
		});
		assert.equal(result.likely_active, true);
		assert.equal(result.expected_peak_w, 800);
		assert.equal(result.units[0]?.demandModel, "bootstrap");
	});

	it("Heating disabled in planCooling erzeugt keine Heizstunden", () => {
		const u = unit({ ac_u1_mode_when_heating: "" });
		const result = planCooling({
			now: new Date("2026-07-05T10:00:00"),
			acConfig: {
				outdoorMaxPowerW: 2000,
				plannerOutdoorLikelyTempC: 28,
				defaultProfileId: "generic",
				units: [u],
			},
			governanceEnabled: true,
			outdoorTempC: 5,
			units: [{ unit: u, roomTempC: 12, consumerStats: undefined }],
		});
		assert.equal(result.units[0]?.heatingHours ?? 0, 0);
	});
});
