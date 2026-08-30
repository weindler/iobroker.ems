import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidSoc, normalizeBatteryPowerW, parseAstroTimeValue, mergeDailyAstroTimes } from "./history";
import {
	computeBatteryRuntimeLearning,
	computeNightConsumption,
	computeNightDischarges,
	computePowerStats,
	computeSocRates,
	computeTopoffStatus,
	estimateRuntimeDays,
	findLastFullCharge,
	fullChargeFromSecondsSince,
	resolveLastFullCharge,
	noSourceResult,
} from "./math";
import { readBatteryRuntimePersist, writeBatteryRuntimePersist } from "./persist";
import { timestampAtLocalTime } from "./time";
import type { PowerPoint, SocPoint } from "./types";
import { MIN_VALID_NIGHTS } from "./constants";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const MS_H = 3_600_000;

function cfg() {
	return {
		enabled: true,
		lookbackDays: 90,
		socStateId: "",
		powerStateId: "",
		powerInvert: false,
		capacityStateId: "",
		secondsSinceFullStateId: "",
		fullChargeSoc: 100,
		topoffIntervalDays: 20,
		nightStart: "22:00",
		nightEnd: "06:00",
		nightAstroEnabled: false,
		nightStartStateId: "",
		nightEndStateId: "",
	};
}

function socAt(dateKey: string, hour: number, socPct: number): SocPoint {
	return {
		ts: timestampAtLocalTime(dateKey, hour, 0),
		socPct,
	};
}

describe("battery runtime validation", () => {
	it("ignores invalid soc and null power", () => {
		assert.equal(isValidSoc(null), false);
		assert.equal(isValidSoc(-1), false);
		assert.equal(isValidSoc(50), true);
		assert.equal(normalizeBatteryPowerW(null), null);
		assert.equal(normalizeBatteryPowerW(10), null);
		assert.equal(normalizeBatteryPowerW(500), 500);
		assert.equal(normalizeBatteryPowerW(-800), -800);
	});

	it("inverts power sign for sources like Sonnen pacTotal", () => {
		assert.equal(normalizeBatteryPowerW(2000, true), -2000);
		assert.equal(normalizeBatteryPowerW(-1500, true), 1500);
	});
});

describe("battery runtime night discharge", () => {
	it("computes average night discharge percent", () => {
		const points: SocPoint[] = [
			socAt("2026-01-05", 22, 80),
			socAt("2026-01-06", 6, 72),
			socAt("2026-01-06", 22, 78),
			socAt("2026-01-07", 6, 70),
		];
		const r = computeNightDischarges({
			socPoints: points,
			nightStart: "22:00",
			nightEnd: "06:00",
			capacityKwh: null,
		});
		assert.equal(r.validNights, 2);
		assert.equal(r.avgPct, 8);
		assert.equal(r.avgKwh, null);
	});

	it("computes kwh with capacity", () => {
		const points: SocPoint[] = [
			socAt("2026-01-05", 22, 80),
			socAt("2026-01-06", 6, 70),
		];
		const r = computeNightDischarges({
			socPoints: points,
			nightStart: "22:00",
			nightEnd: "06:00",
			capacityKwh: 10,
		});
		assert.equal(r.avgKwh, 1);
	});

	it("uses overnight SOC low, not morning recharge nearest sample (≈3.5 kWh)", () => {
		/** Fenster 22–07; Tief 65 % um 05:00; um 07:00 schon wieder 80 % — nearest würde unterschätzen. */
		const points: SocPoint[] = [
			socAt("2026-08-20", 22, 100),
			socAt("2026-08-21", 2, 78),
			socAt("2026-08-21", 5, 65),
			socAt("2026-08-21", 7, 80),
		];
		const r = computeNightDischarges({
			socPoints: points,
			nightStart: "22:00",
			nightEnd: "07:00",
			capacityKwh: 10,
			nowMs: Date.parse("2026-08-21T12:00:00"),
		});
		assert.equal(r.validNights, 1);
		assert.equal(r.avgPct, 35);
		assert.equal(r.avgKwh, 3.5);
	});

	it("does not treat missing kwh as zero without capacity", () => {
		const r = computeNightDischarges({
			socPoints: [socAt("2026-01-05", 22, 80), socAt("2026-01-06", 6, 70)],
			nightStart: "22:00",
			nightEnd: "06:00",
			capacityKwh: null,
		});
		assert.equal(r.avgKwh, null);
	});

	it("uses per-day astro times with fixed fallback", () => {
		const points = [
			socAt("2026-06-20", 22, 80),
			socAt("2026-06-21", 5, 72),
		];
		const astroDaily = mergeDailyAstroTimes(
			[{ ts: Date.parse("2026-06-20T08:00:00"), dateKey: "2026-06-20", hour: 23, minute: 0 }],
			[{ ts: Date.parse("2026-06-21T08:00:00"), dateKey: "2026-06-21", hour: 4, minute: 30 }],
		);
		const r = computeNightDischarges({
			socPoints: points,
			nightStart: "22:00",
			nightEnd: "06:00",
			astroDaily,
			capacityKwh: null,
		});
		assert.equal(r.validNights, 1);
		assert.equal(r.avgPct, 8);
	});

	it("prefers battery_discharge over thin pv_house (zu wenige gültige Nächte)", () => {
		const MS = 3_600_000;
		const day0 = Date.parse("2026-08-10T00:00:00.000Z");
		const socPoints: SocPoint[] = [];
		const battery: PowerPoint[] = [];
		const house: PowerPoint[] = [];
		const pv: PowerPoint[] = [];

		/** 5 Nächte: Batterie entlädt 20–06, SOC −25 % — belastbarer Kandidat. */
		for (let d = 0; d < 5; d++) {
			const evening = day0 + d * 86_400_000 + 20 * MS;
			const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
			socPoints.push({ ts: evening, socPct: 90 });
			socPoints.push({ ts: morning, socPct: 65 });
			for (let h = 0; h < 24; h++) {
				const ts = day0 + d * 86_400_000 + h * MS;
				const discharging = h >= 20 || h < 6;
				battery.push({ ts, powerW: discharging ? -400 : 500 });
				house.push({ ts, powerW: 400 });
				/** Nur eine Nacht PV-Defizit → pv_house dünn; Batterie-Serie bleibt dicht. */
				const pvDeficit = d === 0 && (h >= 19 || h < 7);
				pv.push({ ts, powerW: pvDeficit ? 0 : 3000 });
			}
		}

		const r = computeNightDischarges({
			socPoints,
			nightStart: "22:00",
			nightEnd: "06:00",
			capacityKwh: 10,
			pvPowerPoints: pv,
			housePowerPoints: house,
			batteryPowerPoints: battery,
			nowMs: day0 + 6 * 86_400_000,
		});
		assert.equal(r.method, "battery_discharge");
		assert.ok(r.validNights >= 3, `validNights=${r.validNights}`);
		assert.ok((r.avgKwh ?? 0) >= 2, `avgKwh=${r.avgKwh}`);
	});

	it("prefers denser battery_discharge over barely-ok pv_house (≥ MIN_VALID_NIGHTS)", () => {
		const MS = 3_600_000;
		const day0 = Date.parse("2026-08-01T00:00:00.000Z");
		const socPoints: SocPoint[] = [];
		const battery: PowerPoint[] = [];
		const house: PowerPoint[] = [];
		const pv: PowerPoint[] = [];

		/** 10 Nächte Batterie −25 %; nur 4 Nächte mit PV-Defizit (≥3, aber dünn). */
		for (let d = 0; d < 10; d++) {
			const evening = day0 + d * 86_400_000 + 20 * MS;
			const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
			socPoints.push({ ts: evening, socPct: 90 });
			socPoints.push({ ts: morning, socPct: 65 });
			for (let h = 0; h < 24; h++) {
				const ts = day0 + d * 86_400_000 + h * MS;
				const discharging = h >= 20 || h < 6;
				battery.push({ ts, powerW: discharging ? -400 : 500 });
				house.push({ ts, powerW: 400 });
				const pvDeficit = d < 4 && (h >= 19 || h < 7);
				pv.push({ ts, powerW: pvDeficit ? 0 : 3000 });
			}
		}

		const r = computeNightDischarges({
			socPoints,
			nightStart: "22:00",
			nightEnd: "06:00",
			capacityKwh: 10,
			pvPowerPoints: pv,
			housePowerPoints: house,
			batteryPowerPoints: battery,
			nowMs: day0 + 11 * 86_400_000,
		});
		assert.equal(r.method, "battery_discharge");
		assert.ok(r.validNights >= 7, `validNights=${r.validNights}`);
		assert.ok((r.avgKwh ?? 0) >= 2, `avgKwh=${r.avgKwh}`);
	});

	it("fixed_clock gewinnt nie gegen belastbares pv_house (auch bei mehr Uhr-Nächten)", () => {
		const MS = 3_600_000;
		const day0 = Date.parse("2026-06-01T00:00:00.000Z");
		const socPoints: SocPoint[] = [];
		const battery: PowerPoint[] = [];
		const house: PowerPoint[] = [];
		const pv: PowerPoint[] = [];

		/*
		 * 30 SOC-Nächte (fixed_clock hätte 29 Fenster), aber PV/Haus-Defizit nur in den
		 * letzten 8 Nächten — früher hätte Dominanz fixed_clock gewählt.
		 */
		for (let d = 0; d < 30; d++) {
			const evening = day0 + d * 86_400_000 + 20 * MS;
			const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
			socPoints.push({ ts: evening, socPct: 90 });
			socPoints.push({ ts: morning, socPct: 70 });
			for (let h = 0; h < 24; h++) {
				const ts = day0 + d * 86_400_000 + h * MS;
				const isNight = h >= 20 || h < 6;
				battery.push({ ts, powerW: isNight ? -300 : 400 });
				house.push({ ts, powerW: 300 });
				const pvDeficit = d >= 22 && isNight;
				pv.push({ ts, powerW: pvDeficit ? 0 : 2500 });
			}
		}

		const r = computeNightDischarges({
			socPoints,
			nightStart: "22:00",
			nightEnd: "06:00",
			capacityKwh: 10,
			pvPowerPoints: pv,
			housePowerPoints: house,
			batteryPowerPoints: battery,
			nowMs: day0 + 31 * 86_400_000,
		});
		assert.notEqual(r.method, "fixed_clock");
		assert.ok(
			r.method === "pv_house" || r.method === "battery_discharge",
			`method=${r.method}`,
		);
		assert.ok(r.validNights >= MIN_VALID_NIGHTS, `validNights=${r.validNights}`);
	});
});

describe("battery runtime night consumption + dynamic reserve (Phase 1d)", () => {
	function buildTenNightPvHouseScenario() {
		const MS = 3_600_000;
		const day0 = Date.parse("2026-01-10T00:00:00.000Z");
		const socPoints: SocPoint[] = [];
		const battery: PowerPoint[] = [];
		const house: PowerPoint[] = [];
		const pv: PowerPoint[] = [];

		/** 10 gleiche Nächte: 20–06 Uhr (10 h) PV=0, Haus 500 W konstant, Batterie deckt das Defizit. */
		for (let d = 0; d < 10; d++) {
			const evening = day0 + d * 86_400_000 + 20 * MS;
			const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
			socPoints.push({ ts: evening, socPct: 90 });
			socPoints.push({ ts: morning, socPct: 65 });
			for (let h = 0; h < 24; h++) {
				const ts = day0 + d * 86_400_000 + h * MS;
				const isNight = h >= 20 || h < 6;
				battery.push({ ts, powerW: isNight ? -500 : 300 });
				house.push({ ts, powerW: 500 });
				pv.push({ ts, powerW: isNight ? 0 : 3000 });
			}
		}
		return { socPoints, battery, house, pv, day0 };
	}

	it("computeNightConsumption integriert Hauslast über dieselben Fenster wie die Entladung", () => {
		const { socPoints, battery, house, pv, day0 } = buildTenNightPvHouseScenario();
		const nowMs = day0 + 11 * 86_400_000;
		const discharge = computeNightDischarges({
			socPoints,
			nightStart: "22:00",
			nightEnd: "06:00",
			capacityKwh: 20,
			pvPowerPoints: pv,
			housePowerPoints: house,
			batteryPowerPoints: battery,
			nowMs,
		});
		assert.equal(discharge.method, "pv_house");
		assert.ok(discharge.windows.length >= 8, `windows=${discharge.windows.length}`);

		const consumption = computeNightConsumption({
			windows: discharge.windows,
			housePowerPoints: house,
			batteryPowerPoints: battery,
			socPoints,
			capacityKwh: 20,
			nightStart: "22:00",
			nightEnd: "06:00",
			nowMs,
		});
		// 500 W über ~10 h Nachtfenster ≈ 5 kWh/Nacht; SOC/Batterie decken dasselbe.
		assert.ok(consumption.avgKwh !== null && consumption.avgKwh > 4.5 && consumption.avgKwh < 5.5, `avgKwh=${consumption.avgKwh}`);
		assert.ok(consumption.validNights >= 8, `validNights=${consumption.validNights}`);
	});

	it("computeBatteryRuntimeLearning veröffentlicht predictedNightConsumptionKwh, avgNightLoadW und dynamische Reserve", () => {
		const { socPoints, battery, house, pv, day0 } = buildTenNightPvHouseScenario();
		const nowMs = day0 + 11 * 86_400_000;
		const r = computeBatteryRuntimeLearning({
			socPoints,
			secondsSinceFull: null,
			powerPoints: battery,
			pvPowerPoints: pv,
			housePowerPoints: house,
			capacityKwh: 20,
			currentSocPct: 80,
			cfg: cfg(),
			sourceSocStateId: "x",
			sourcePowerStateId: "y",
			now: new Date(nowMs),
			sampleDays: 11,
		});

		assert.ok(r.predictedNightConsumptionKwh !== null && r.predictedNightConsumptionKwh > 4.5, `predictedNightConsumptionKwh=${r.predictedNightConsumptionKwh}`);
		// Batterie deckt fast die gesamte Nachtlast → Netzbezug nahe 0.
		assert.ok((r.predictedNightGridImportKwh ?? 0) < 1, `predictedNightGridImportKwh=${r.predictedNightGridImportKwh}`);
		// avgNightLoadW muss ~500 W ergeben (Hauslast-Eingabe), keine Verzerrung durch falsche Stundenbasis.
		assert.ok(r.avgNightLoadW !== null && r.avgNightLoadW > 400 && r.avgNightLoadW < 600, `avgNightLoadW=${r.avgNightLoadW}`);
		// Reserve: predictedNightConsumptionKwh(~5) * 1.2 / capacityKwh(20) * 100 ≈ 30 %.
		assert.ok(r.requiredSocAtPvEndPct !== null && r.requiredSocAtPvEndPct > 20 && r.requiredSocAtPvEndPct < 40, `requiredSocAtPvEndPct=${r.requiredSocAtPvEndPct}`);
		assert.ok(r.nightReserveReasonDe.length > 0);
	});

	it("nutzt SOC-/Batterie-Nachtenergie wenn Hausverbrauch fehlt (kein versteckter Fallback-Prozent)", () => {
		const { socPoints, battery, pv, day0 } = buildTenNightPvHouseScenario();
		const nowMs = day0 + 11 * 86_400_000;
		const r = computeBatteryRuntimeLearning({
			socPoints,
			secondsSinceFull: null,
			powerPoints: battery,
			pvPowerPoints: pv,
			housePowerPoints: [],
			capacityKwh: 20,
			currentSocPct: 80,
			cfg: cfg(),
			sourceSocStateId: "x",
			sourcePowerStateId: "y",
			now: new Date(nowMs),
			sampleDays: 11,
		});
		// SOC 90→65 auf 20 kWh = 5 kWh; Batterie −500 W × ~10 h ≈ 5 kWh.
		assert.ok(r.predictedNightConsumptionKwh !== null && r.predictedNightConsumptionKwh > 4, `predictedNightConsumptionKwh=${r.predictedNightConsumptionKwh}`);
		assert.ok(r.requiredSocAtPvEndPct !== null && r.requiredSocAtPvEndPct > 20, `requiredSocAtPvEndPct=${r.requiredSocAtPvEndPct}`);
	});

	it("liefert null wenn weder Haus- noch Batterie-/SOC-Nachtenergie belastbar ist", () => {
		const r = computeBatteryRuntimeLearning({
			socPoints: [],
			secondsSinceFull: null,
			powerPoints: [],
			pvPowerPoints: [],
			housePowerPoints: [],
			capacityKwh: 20,
			currentSocPct: 80,
			cfg: cfg(),
			sourceSocStateId: "x",
			sourcePowerStateId: "y",
			now: new Date(),
			sampleDays: 0,
		});
		assert.equal(r.predictedNightConsumptionKwh, null);
		assert.equal(r.requiredSocAtPvEndPct, null);
		assert.match(r.nightReserveReasonDe, /Nachtverbrauch/);
	});

	it("predictedNightConsumptionKwh nimmt max(Haus, SOC, Batterie) — keine Haus-only-Unterschätzung", () => {
		const MS = 3_600_000;
		const day0 = Date.parse("2026-01-10T00:00:00.000Z");
		const socPoints: SocPoint[] = [];
		const battery: PowerPoint[] = [];
		const house: PowerPoint[] = [];
		const pv: PowerPoint[] = [];

		/*
		 * Hauslast-Historie unterschätzt (lückenhafte/niedrige Werte ~200 W),
		 * reale Batterie entlädt ~400 W, SOC 100→63 auf 10 kWh ≈ 3.7 kWh.
		 * Dynamische Brücke startet erst 22 Uhr, Uhr-Hülle 22–06 bleibt deckungsgleich;
		 * SOC-/Batterie-Signal muss die Reserve-Basis tragen.
		 */
		for (let d = 0; d < 10; d++) {
			const evening = day0 + d * 86_400_000 + 20 * MS;
			const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
			socPoints.push({ ts: evening, socPct: 100 });
			socPoints.push({ ts: morning, socPct: 63 });
			for (let h = 0; h < 24; h++) {
				const ts = day0 + d * 86_400_000 + h * MS;
				const isNight = h >= 20 || h < 6;
				battery.push({ ts, powerW: isNight ? -400 : 300 });
				house.push({ ts, powerW: isNight ? 200 : 400 });
				pv.push({ ts, powerW: isNight ? 0 : 3000 });
			}
		}

		const r = computeBatteryRuntimeLearning({
			socPoints,
			secondsSinceFull: null,
			powerPoints: battery,
			pvPowerPoints: pv,
			housePowerPoints: house,
			capacityKwh: 10,
			currentSocPct: 80,
			cfg: cfg(),
			sourceSocStateId: "x",
			sourcePowerStateId: "y",
			now: new Date(day0 + 11 * 86_400_000),
			sampleDays: 11,
		});

		// Haus allein ≈ 2.0 kWh; SOC ≈ 3.7; Batterie ≈ 4.0 — Reserve-Basis muss ≥ SOC sein.
		assert.ok(
			r.predictedNightConsumptionKwh !== null && r.predictedNightConsumptionKwh >= 3.5,
			`predictedNightConsumptionKwh=${r.predictedNightConsumptionKwh} (Haus-only wäre ~2)`,
		);
		// avgNightLoadW = predicted / bridgeHours — konsistent zur Reserve-Basis, nicht mehr Haus-only.
		assert.ok(
			r.avgNightLoadW !== null && r.avgNightLoadW > 300,
			`avgNightLoadW=${r.avgNightLoadW}`,
		);
		assert.equal(r.nightBridgeMethod, "pv_house");
		assert.ok(
			r.requiredNightReserveKwh !== null && r.requiredNightReserveKwh >= 3.5 * 1.2 - 0.05,
			`requiredNightReserveKwh=${r.requiredNightReserveKwh}`,
		);
	});

	it("Sondernacht mit Netzladung (SOC steigt) fließt nicht in die Reserve-Basis", () => {
		const MS = 3_600_000;
		const day0 = Date.parse("2026-01-10T00:00:00.000Z");
		const socPoints: SocPoint[] = [];
		const battery: PowerPoint[] = [];
		const house: PowerPoint[] = [];
		const pv: PowerPoint[] = [];

		for (let d = 0; d < 10; d++) {
			const evening = day0 + d * 86_400_000 + 20 * MS;
			const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
			const chargeNight = d === 5;
			socPoints.push({ ts: evening, socPct: chargeNight ? 40 : 90 });
			socPoints.push({ ts: morning, socPct: chargeNight ? 80 : 65 });
			for (let h = 0; h < 24; h++) {
				const ts = day0 + d * 86_400_000 + h * MS;
				const isNight = h >= 20 || h < 6;
				battery.push({ ts, powerW: isNight ? (chargeNight ? 1500 : -500) : 300 });
				house.push({ ts, powerW: 500 });
				pv.push({ ts, powerW: isNight ? 0 : 3000 });
			}
		}

		const r = computeBatteryRuntimeLearning({
			socPoints,
			secondsSinceFull: null,
			powerPoints: battery,
			pvPowerPoints: pv,
			housePowerPoints: house,
			capacityKwh: 20,
			currentSocPct: 80,
			cfg: cfg(),
			sourceSocStateId: "x",
			sourcePowerStateId: "y",
			now: new Date(day0 + 11 * 86_400_000),
			sampleDays: 11,
		});

		// Ohne die Ladenacht bleibt ~5 kWh; die Ladenacht darf nicht nach unten/oben verzerren.
		assert.ok(
			r.predictedNightConsumptionKwh !== null &&
				r.predictedNightConsumptionKwh > 4.5 &&
				r.predictedNightConsumptionKwh < 5.5,
			`predictedNightConsumptionKwh=${r.predictedNightConsumptionKwh}`,
		);
	});

	it("extrem hohe Hauslast (EV) ohne Batterie-Entladung wird nicht als Reserve übernommen", () => {
		const MS = 3_600_000;
		const day0 = Date.parse("2026-01-10T00:00:00.000Z");
		const socPoints: SocPoint[] = [];
		const battery: PowerPoint[] = [];
		const house: PowerPoint[] = [];
		const pv: PowerPoint[] = [];

		for (let d = 0; d < 10; d++) {
			const evening = day0 + d * 86_400_000 + 20 * MS;
			const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
			const evNight = d === 3;
			socPoints.push({ ts: evening, socPct: 90 });
			socPoints.push({ ts: morning, socPct: 65 });
			for (let h = 0; h < 24; h++) {
				const ts = day0 + d * 86_400_000 + h * MS;
				const isNight = h >= 20 || h < 6;
				battery.push({ ts, powerW: isNight ? -500 : 300 });
				house.push({ ts, powerW: isNight ? (evNight ? 7000 : 500) : 400 });
				pv.push({ ts, powerW: isNight ? 0 : 3000 });
			}
		}

		const r = computeBatteryRuntimeLearning({
			socPoints,
			secondsSinceFull: null,
			powerPoints: battery,
			pvPowerPoints: pv,
			housePowerPoints: house,
			capacityKwh: 20,
			currentSocPct: 80,
			cfg: cfg(),
			sourceSocStateId: "x",
			sourcePowerStateId: "y",
			now: new Date(day0 + 11 * 86_400_000),
			sampleDays: 11,
		});

		// EV-Nacht ~70 kWh Haus darf den Ø nicht auf >10 kWh ziehen.
		assert.ok(
			r.predictedNightConsumptionKwh !== null && r.predictedNightConsumptionKwh < 8,
			`predictedNightConsumptionKwh=${r.predictedNightConsumptionKwh}`,
		);
	});
});

describe("battery runtime astro parse", () => {
	it("parses HH:MM:SS astro strings", () => {
		assert.deepEqual(parseAstroTimeValue("22:03:12"), { hour: 22, minute: 3 });
		assert.deepEqual(parseAstroTimeValue("04:22:52"), { hour: 4, minute: 22 });
		assert.equal(parseAstroTimeValue(""), null);
	});
});

describe("battery runtime rates and power", () => {
	it("separates charge and discharge soc rates", () => {
		const points: SocPoint[] = [
			{ ts: 0, socPct: 50 },
			{ ts: MS_H, socPct: 55 },
			{ ts: 2 * MS_H, socPct: 52 },
		];
		const r = computeSocRates(points);
		assert.equal(r.avgChargeRatePctH, 5);
		assert.equal(r.avgDischargeRatePctH, 3);
	});

	it("computes max charge and discharge power", () => {
		const points: PowerPoint[] = [
			{ ts: 0, powerW: 2000 },
			{ ts: MS_H, powerW: -1500 },
			{ ts: 2 * MS_H, powerW: 3000 },
		];
		const r = computePowerStats(points);
		assert.equal(r.maxChargePowerW, 3000);
		assert.equal(r.maxDischargePowerW, 1500);
		assert.equal(r.avgChargePowerW, 2500);
		assert.equal(r.avgDischargePowerW, 1500);
	});
});

describe("battery runtime full charge and topoff", () => {
	it("detects last full charge at 100%", () => {
		const points: SocPoint[] = [
			{ ts: Date.parse("2026-01-01T10:00:00Z"), socPct: 90 },
			{ ts: Date.parse("2026-01-10T10:00:00Z"), socPct: 100 },
			{ ts: Date.parse("2026-01-11T10:00:00Z"), socPct: 92 },
		];
		assert.equal(findLastFullCharge(points, 100), "2026-01-10T10:00:00.000Z");
	});

	it("does not treat 95% as full when threshold is 100%", () => {
		const points: SocPoint[] = [{ ts: Date.parse("2026-06-30T10:00:00Z"), socPct: 95 }];
		assert.equal(findLastFullCharge(points, 100), null);
	});

	it("detects full charge peak missed by hourly dedup", () => {
		const hourly: SocPoint[] = [
			{ ts: Date.parse("2026-06-30T09:00:00Z"), socPct: 88 },
			{ ts: Date.parse("2026-06-30T10:00:00Z"), socPct: 91 },
		];
		const raw: SocPoint[] = [
			...hourly,
			{ ts: Date.parse("2026-06-30T09:45:00Z"), socPct: 100 },
		];
		assert.equal(findLastFullCharge(hourly, 100), null);
		assert.equal(findLastFullCharge(raw, 100), "2026-06-30T09:45:00.000Z");
	});

	it("prefers live soc when currently full", () => {
		const points: SocPoint[] = [{ ts: Date.parse("2026-06-29T10:00:00Z"), socPct: 100 }];
		const liveTs = Date.parse("2026-06-30T14:00:00Z");
		assert.equal(
			findLastFullCharge(points, 100, { socPct: 100, ts: liveTs }),
			"2026-06-30T14:00:00.000Z",
		);
	});

	it("uses Sonnen secondsSinceFullCharge when available", () => {
		const now = new Date("2026-07-01T12:00:00.000Z");
		const seconds = 86_400;
		const resolved = resolveLastFullCharge({
			secondsSinceFull: seconds,
			socPointsForFullCharge: [],
			fullChargeSoc: 100,
			currentSocPct: 80,
			now,
		});
		assert.equal(resolved.fullChargeSource, "device");
		assert.equal(resolved.lastFullCharge, fullChargeFromSecondsSince(seconds, now));
		const topoff = computeTopoffStatus({
			lastFullCharge: resolved.lastFullCharge,
			topoffIntervalDays: 20,
			now,
		});
		assert.equal(topoff.daysSinceFull, 1);
	});

	it("falls back to soc history when device counter missing", () => {
		const now = new Date("2026-07-01T12:00:00.000Z");
		const resolved = resolveLastFullCharge({
			secondsSinceFull: null,
			socPointsForFullCharge: [
				{ ts: Date.parse("2026-06-30T10:00:00Z"), socPct: 100 },
			],
			fullChargeSoc: 100,
			currentSocPct: 80,
			now,
		});
		assert.equal(resolved.fullChargeSource, "soc_history");
		assert.equal(resolved.lastFullCharge, "2026-06-30T10:00:00.000Z");
	});

	it("computes topoff remaining and due", () => {
		const now = new Date("2026-01-25T12:00:00Z");
		const r = computeTopoffStatus({
			lastFullCharge: "2026-01-01T12:00:00.000Z",
			topoffIntervalDays: 20,
			now,
		});
		assert.equal(r.daysSinceFull, 24);
		assert.equal(r.topoffDaysRemaining, 0);
		assert.equal(r.topoffDue, true);
	});

	it("counts calendar days since full charge (yesterday = 1)", () => {
		const r = computeTopoffStatus({
			lastFullCharge: "2026-06-30T20:00:00.000Z",
			topoffIntervalDays: 20,
			now: new Date("2026-07-01T15:00:00.000Z"),
		});
		assert.equal(r.daysSinceFull, 1);
		assert.equal(r.topoffDaysRemaining, 19);
	});

	it("returns null topoff without full charge history", () => {
		const r = computeTopoffStatus({
			lastFullCharge: null,
			topoffIntervalDays: 20,
			now: new Date(),
		});
		assert.equal(r.daysSinceFull, null);
		assert.equal(r.topoffDue, null);
	});
});

describe("battery runtime compute", () => {
	it("estimates runtime days from night discharge", () => {
		assert.equal(estimateRuntimeDays(80, 8), 10);
		assert.equal(estimateRuntimeDays(80, null), null);
	});

	it("no_source without soc mapping", () => {
		const r = noSourceResult(cfg());
		assert.equal(r.status, "no_source");
		assert.equal(r.avgNightDischargePct, null);
	});
});

describe("battery runtime persist", () => {
	it("roundtrips persist file", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-"));
		const points = [socAt("2026-01-05", 22, 80), socAt("2026-01-06", 6, 70)];
		const result = computeBatteryRuntimeLearning({
			socPoints: points,
			powerPoints: [],
			secondsSinceFull: null,
			capacityKwh: 10,
			currentSocPct: 75,
			cfg: cfg(),
			sourceSocStateId: "sonnen.0.status.userSoc",
			sourcePowerStateId: "",
			now: new Date("2026-01-07T10:00:00"),
			sampleDays: 2,
		});
		await writeBatteryRuntimePersist(dir, result, "2026-01-07T10:00:00.000Z");
		const read = await readBatteryRuntimePersist(dir);
		assert.ok(read);
		assert.equal(read?.module, "battery_runtime_learning_v1");
	});
});
