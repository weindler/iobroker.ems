/**
 * Realer Beta-Replay ~10:55 lokal (08.08.2026) — Regression gegen Live-Snapshot.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { operatorQuality } from "../../quality";
import { allocateUnifiedDayPlan } from "./allocate";
import { buildSlots, golden001Input } from "./fixtures";
import { buildProductSummaryDe, buildUnifiedDayAgendaDe } from "../../../beta/product_summary";
import { runImmersionFsm } from "../../../addons/immersion_heater/runtime/fsm";
import { immersionDeviceConfigFromAdapter } from "../../../addons/immersion_heater/device_config";
import { emptyPersist } from "../../../addons/immersion_heater/runtime/persist";
import type { UnifiedAllocationCell, UnifiedDayPlannerInput } from "./types";

const TZ = "Europe/Berlin";
const Q = operatorQuality("valid", "beta-1055", 80);
const FRESH = { observedAtIso: "2026-08-08T08:55:00.000Z", ageSec: 5, quality: Q };

/** ~10:55 CEST, PV≈5 kW, residual Export≈4,49 kW, Bat 100 %, Puffer 49 °C. */
export function betaReplay1055Input(): UnifiedDayPlannerInput {
	const nowIso = "2026-08-08T08:55:00.000Z"; // 10:55 CEST
	const emptyAt = "2026-08-08T15:25:00.000Z"; // 17:25 CEST
	const slots = buildSlots(nowIso, 48);
	const base = golden001Input();
	base.time = {
		...base.time,
		nowIso,
		timezone: TZ,
		slots,
		horizonStartIso: slots[0]!.startIso,
		horizonEndIso: slots[slots.length - 1]!.endIso,
	};

	const livePvW = 5000;
	const liveExportW = 4490;
	const liveHouseW = livePvW - liveExportW; // ≈510 W
	base.pv.slots = slots.map((s) => {
		const t = Date.parse(s.startIso);
		const h = new Date(s.startIso).getUTCHours();
		const day0 = t < Date.parse("2026-08-09T00:00:00.000Z");
		let power = 0;
		if (day0) {
			if (Math.abs(t - Date.parse(nowIso)) < 15 * 60_000) power = livePvW;
			else if (h >= 8 && h < 14) power = 4200;
			else if (h >= 14 && h < 16) power = 1600;
			else if (h >= 6 && h < 18) power = 800;
		} else if (h >= 7 && h < 16) {
			power = 3800;
		}
		return {
			slot: s,
			forecastPowerW: power,
			observedPowerW: Math.abs(t - Date.parse(nowIso)) < 15 * 60_000 ? livePvW : null,
			energyKwh: (power / 1000) * 0.25,
		};
	});
	base.pv.expectedDayEnergyKwh = 43.6;
	base.houseLoad.slots = slots.map((s) => {
		const t = Date.parse(s.startIso);
		const power = Math.abs(t - Date.parse(nowIso)) < 15 * 60_000 ? liveHouseW : 900;
		return {
			slot: s,
			forecastPowerW: power,
			observedPowerW: Math.abs(t - Date.parse(nowIso)) < 15 * 60_000 ? liveHouseW : null,
			energyKwh: (power / 1000) * 0.25,
		};
	});
	base.houseLoad.expectedDayEnergyKwh = 22.3;
	base.prices.slots = slots.map((s) => {
		const h = new Date(s.startIso).getUTCHours();
		const night = h >= 22 || h < 5;
		return {
			slot: s,
			importCtPerKwh: night ? 12 : 26,
			exportCtPerKwh: 8,
			gridImportAllowed: true,
		};
	});
	base.battery = {
		...base.battery,
		socPct: 100,
		usableCapacityKwh: 10,
		minSocPct: 10,
		maxSocPct: 100,
		reserveSocPct: 10,
		nightReserveKwh: 2.5,
		maxChargePowerW: 4600,
		requiredChargeEnergyKwh: 0,
		endSocTargetPct: null,
		chargeDeadlineIso: null,
		gridChargeAllowed: true,
		uncertainty: Q,
		freshness: FRESH,
	};
	base.thermal = {
		bufferTempC: 49,
		minTempC: 44,
		maxTempC: 63,
		dayTargetTempC: 58,
		availablePowerW: 1700,
		minPowerW: 1700,
		headroomEnergyKwh: 3.8,
		estimatedEmptyAtIso: emptyAt,
		deadlineIso: emptyAt,
		emptyAtSource: "estimated",
		nightBridgeActive: true,
		coolingRateCPerH: 0.7,
		minimumRuntimeSec: 300,
		hysteresisK: 5,
		reheatHysteresisActive: true,
		uncertainty: operatorQuality("degraded", "estimated empty_at", 55),
		freshness: FRESH,
	};
	base.climate = {
		units: [
			{
				unitId: "air_conditioning.unit_1",
				label: "Wohnzimmer",
				roomTempC: 26.2,
				comfortMinC: null,
				comfortMaxC: 25.5,
				targetTempC: 25.0,
				mandatoryComfort: true, // real laufend / Komfortbedarf jetzt
				expectedEnergyKwh: 2.8,
				typicalPowerW: 850, // Config-Nominal; learned ~727 W ist Runtime-Prognose
				maxShiftHours: 0,
				uncertainty: Q,
			},
			{
				unitId: "air_conditioning.unit_2",
				label: "Josef",
				roomTempC: 24.0,
				comfortMinC: null,
				comfortMaxC: 26.0,
				targetTempC: 25.5,
				mandatoryComfort: false,
				expectedEnergyKwh: 1.2,
				typicalPowerW: 700, // Config-Nominal; learned ~715 W
				maxShiftHours: 3,
				uncertainty: Q,
			},
		],
		freshness: FRESH,
	};
	base.wallbox = null;
	base.globalMode = "balanced";
	return base;
}

function sumKind(plan: ReturnType<typeof allocateUnifiedDayPlan>, kind: string): number {
	return plan.allocations
		.filter((a) => a.kind === kind)
		.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}

function byConsumer(plan: ReturnType<typeof allocateUnifiedDayPlan>, id: string): number {
	return plan.allocations
		.filter((a) => a.consumerId === id)
		.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}

function formatSlotPlan(plan: ReturnType<typeof allocateUnifiedDayPlan>): string[] {
	const tz = plan.timezone;
	const fmt = (iso: string) =>
		new Intl.DateTimeFormat("de-DE", {
			timeZone: tz,
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date(iso));

	const bySlot = new Map<string, UnifiedAllocationCell[]>();
	for (const a of plan.allocations) {
		if (a.allocatedEnergyKwh < 0.02) continue;
		const k = a.slot.startIso;
		const list = bySlot.get(k) ?? [];
		list.push(a);
		bySlot.set(k, list);
	}
	const lines: string[] = [];
	const keys = [...bySlot.keys()].sort();
	for (const k of keys) {
		const cells = bySlot.get(k)!;
		const end = cells[0]!.slot.endIso;
		const parts = cells.map(
			(c) =>
				`${c.consumerId.replace(/^air_conditioning\./, "klima.")}:${(c.allocatedPowerW / 1000).toFixed(2)}kW/${c.allocatedEnergyKwh.toFixed(2)}kWh(${c.energySource})`,
		);
		lines.push(`${fmt(k)}–${fmt(end)}  ${parts.join(" | ")}`);
	}
	return lines;
}

describe("BETA-REPLAY-1055 real midday snapshot", () => {
	it("battery full → no charge; Wohnzimmer comfort now; thermal preload; wallbox idle", () => {
		const input = betaReplay1055Input();
		const plan = allocateUnifiedDayPlan(input);

		assert.equal(sumKind(plan, "battery_charge"), 0, "SOC 100% → keine Batterie-Ladeallocation");
		assert.ok(byConsumer(plan, "air_conditioning.unit_1") > 1.0, "Wohnzimmer muss freigegeben sein");
		assert.ok(
			byConsumer(plan, "air_conditioning.unit_2") > 0.3,
			"Josef (flex) muss bei hohem PV-Surplus mitgeplant werden — kein Planner-Artefakt-Block",
		);
		assert.ok(sumKind(plan, "immersion_heater") > 1.5, "Heizstab muss thermisch vorplanen");
		const emptyAt = input.thermal!.deadlineIso!;
		const ihBefore = plan.allocations
			.filter((a) => a.kind === "immersion_heater" && Date.parse(a.slot.startIso) < Date.parse(emptyAt))
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		assert.ok(ihBefore > 1.0, `thermal vor empty_at, got ${ihBefore}`);
		assert.equal(sumKind(plan, "wallbox"), 0);
		assert.equal(
			plan.allocations.filter(
				(a) => a.kind === "immersion_heater" && (a.energySource === "battery" || a.energySource === "mixed"),
			).length,
			0,
		);

		// FSM: Unified 1700 W NOW trotz Hysterese-Band (Re-Enable 46,6 °C)
		const cfg = immersionDeviceConfigFromAdapter({
			ih_stage_count: 1,
			ih_stage_1_set_state: "relay.0.heater",
			ih_stage_1_nominal_power_w: 1700,
			ih_buffer_temp_c_target: "sensor.0.temp",
			ih_buffer_temp_c_enabled: true,
			ih_temperature_hysteresis_k: 5,
			ih_planning_min_temp_c: 44,
			ih_planning_max_temp_c: 63,
		});
		const fsm = runImmersionFsm({
			nowMs: Date.parse(input.time.nowIso),
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: 51.6,
			temperature: { valueC: 49, status: "valid", observedAtMs: Date.parse(input.time.nowIso) },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: { ...emptyPersist(), autoTargetReached: true, commandedStage: 0 },
			config: cfg,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(fsm.commandedStage, 1);
		assert.equal(fsm.reason, "auto_planner_heating");

		const agenda = buildUnifiedDayAgendaDe(plan);
		assert.ok(agenda.some((l) => /Heizstab|thermisch/i.test(l)));
		assert.ok(agenda.some((l) => /Klima/i.test(l)));
		assert.ok(!agenda.some((l) => /Batterie laden/i.test(l)), "keine Ladezeile bei SOC 100%");

		const summary = buildProductSummaryDe(plan, { batteryStartSocPct: 100 });
		assert.match(summary, /43,6|Heute/);

		// Vollständiger Slotplan für manuelle Abnahme (stdout bei Testlauf)
		const slots = formatSlotPlan(plan);
		assert.ok(slots.length > 0);
		// eslint-disable-next-line no-console
		console.log("\n=== BETA-REPLAY-1055 SLOTPLAN ===\n" + slots.join("\n"));
		// eslint-disable-next-line no-console
		console.log("\nAGENDA:\n - " + agenda.join("\n - "));
		// eslint-disable-next-line no-console
		console.log("\nSUMMARY:\n" + summary);
		// eslint-disable-next-line no-console
		console.log(
			"\nTOTALS kWh:",
			JSON.stringify({
				battery_charge: sumKind(plan, "battery_charge"),
				immersion: sumKind(plan, "immersion_heater"),
				wohnzimmer: byConsumer(plan, "air_conditioning.unit_1"),
				josef: byConsumer(plan, "air_conditioning.unit_2"),
				wallbox: sumKind(plan, "wallbox"),
				export: plan.expectedGridExportEnergyKwh,
			}),
		);
	});
});
