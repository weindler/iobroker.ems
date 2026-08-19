import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BATTERY_CONSUMER_CONSTRAINT_STATES,
	batteryConsumerConstraintStateWrites,
	resolveAllBatteryConsumerAccess,
	batteryConsumersConfigFromAdapter,
} from "../../policy/battery_consumers";
import { resetDailyPlanRevisionForTest, runDailyPlanTick } from "./tick";
import type { ForecastPlan } from "../forecast/types";
import { operatorQuality } from "../quality";
import { CONTRIBUTION_IDS } from "../contribution_ids";
import { baseContribution, pvContributorRef } from "../contributions/types";
import { addonContributorRef, systemContributorRef } from "../contributor";

const TICK_SRC = join(__dirname, "..", "..", "..", "src", "operator", "daily_plan", "tick.ts");

function forecastForTick(now: Date): ForecastPlan {
	const start = "2026-08-19T10:00:00.000Z";
	const end = "2026-08-19T10:15:00.000Z";
	return {
		generatedAt: now.toISOString(),
		validUntil: null,
		revision: 1,
		timezone: "UTC",
		horizonStart: start,
		horizonEnd: "2026-08-21T10:00:00.000Z",
		slotMinutes: 15,
		status: "ready",
		activeContributors: [],
		excludedContributors: [],
		days: [
			{
				date: "2026-08-19",
				pvEnergyKwh: 20,
				houseLoadEnergyKwh: 10,
				renewableBalanceKwh: 10,
				weatherMinTempC: null,
				weatherMaxTempC: null,
				quality: operatorQuality("valid", "OK"),
				reasonDe: "OK",
			},
		],
		slots: [
			{
				slot: { startIso: start, endIso: end },
				pvPowerW: 3000,
				houseLoadPowerW: 500,
				fixedBalancePowerW: 2500,
				gridPriceCtPerKwh: 20,
				gridImportAllowed: true,
				gridMaxImportPowerW: 11000,
				outdoorTempC: null,
				quality: operatorQuality("valid", "OK"),
				reasonDe: "OK",
			},
		],
		contributions: [
			baseContribution(CONTRIBUTION_IDS.PV_SUPPLY, pvContributorRef(), "provide", ["supply"], {
				generatedAt: now.toISOString(),
				validUntil: null,
				revision: 1,
				enabled: true,
				flexible: false,
				gridEligible: false,
				quality: operatorQuality("valid", "PV", 80),
				reasonDe: "PV",
				details: {
					correctedTodayKwh: 20,
					rawTodayKwh: 20,
					lastUpdateTs: now.toISOString(),
					status: "ready",
				},
				slots: [],
			}),
			baseContribution(
				CONTRIBUTION_IDS.HOUSE_LOAD_FIXED,
				systemContributorRef("house_load"),
				"consume",
				["demand_fixed"],
				{
					generatedAt: now.toISOString(),
					validUntil: null,
					revision: 1,
					enabled: true,
					flexible: false,
					gridEligible: false,
					quality: operatorQuality("valid", "load", 70),
					reasonDe: "load",
					details: {},
					slots: [],
				},
			),
			baseContribution(
				CONTRIBUTION_IDS.GRID_SUPPLY,
				systemContributorRef("grid_supply"),
				"provide",
				["supply"],
				{
					generatedAt: now.toISOString(),
					validUntil: null,
					revision: 1,
					enabled: true,
					flexible: false,
					gridEligible: true,
					quality: operatorQuality("valid", "grid", 90),
					reasonDe: "grid",
					details: {},
					slots: [],
				},
			),
			baseContribution(
				CONTRIBUTION_IDS.BATTERY_CHARGE,
				addonContributorRef("battery"),
				"consume",
				["storage"],
				{
					generatedAt: now.toISOString(),
					validUntil: null,
					revision: 1,
					enabled: true,
					flexible: true,
					gridEligible: false,
					quality: operatorQuality("valid", "bat", 80),
					reasonDe: "bat",
					details: { socPct: 80, maxChargePowerW: 5000, requiredEnergyKwh: 2 },
					slots: [],
				},
			),
		],
		quality: operatorQuality("valid", "OK"),
		reasonDe: "OK",
	};
}

function mockHost(config: Record<string, unknown> = {}) {
	const states = new Map<string, unknown>();
	const writeCounts = new Map<string, number>();
	const cfg: Record<string, unknown> = {
		intent_timezone: "UTC",
		bat_hw_max_charge_w: 5000,
		bat_hw_min_soc_pct: 10,
		bat_hw_max_soc_pct: 100,
		...config,
	};
	return {
		config: cfg,
		states,
		writeCounts,
		log: { warn: () => {}, debug: () => {} },
		async getStateAsync(id: string) {
			if (!states.has(id)) return null;
			return { val: states.get(id), ts: Date.now() };
		},
		async setStateAsync(id: string, state: { val?: unknown } | unknown) {
			const val =
				state && typeof state === "object" && "val" in (state as object)
					? (state as { val: unknown }).val
					: state;
			states.set(id, val);
			writeCounts.set(id, (writeCounts.get(id) ?? 0) + 1);
		},
		async getForeignStateAsync() {
			return null;
		},
	};
}

describe("batteryConsumerConstraintStateWrites", () => {
	it("maps all three consumers to Admin live-status ids", () => {
		const access = resolveAllBatteryConsumerAccess({
			config: batteryConsumersConfigFromAdapter({
				bat_consumer_immersion_may_use_battery: true,
				bat_consumer_immersion_only_when_critical: false,
				bat_consumer_climate_may_use_battery: true,
				bat_consumer_climate_only_when_critical: false,
				bat_consumer_wallbox_may_use_battery: true,
			}),
			batteryHoldActive: false,
			socPct: 80,
			criticalByConsumer: {
				immersion_heater: false,
				air_conditioning: false,
				wallbox: false,
			},
		});
		const writes = batteryConsumerConstraintStateWrites(access);
		assert.equal(writes.length, 6);
		const byId = Object.fromEntries(writes.map((w) => [w.id, w.val]));
		assert.equal(byId[BATTERY_CONSUMER_CONSTRAINT_STATES.immersion_heater.allowed], true);
		assert.equal(byId[BATTERY_CONSUMER_CONSTRAINT_STATES.air_conditioning.allowed], true);
		assert.equal(byId[BATTERY_CONSUMER_CONSTRAINT_STATES.wallbox.allowed], true);
	});
});

describe("Daily Plan publishes planner.constraints from Admin config", () => {
	it("always refreshes consumer + hold + planner heartbeat via setStateAsync", () => {
		const tick = readFileSync(TICK_SRC, "utf8");
		const publishSrc = join(
			__dirname,
			"..",
			"..",
			"..",
			"src",
			"policy",
			"battery_consumers",
			"publish.ts",
		);
		const publish = readFileSync(publishSrc, "utf8");
		for (const id of [
			"planner.constraints.battery_hold_active",
			"planner.constraints.evcc_battery_hold",
			"planner.global_mode.active",
			"planner.last_run_at",
			"planner.status",
		]) {
			assert.match(tick, new RegExp(id.replace(/\./g, "\\.")));
			assert.equal(tick.includes(`setStateIfChanged(host, "${id}"`), false, id);
		}
		assert.match(tick, /batteryConsumerConstraintStateWrites/);
		for (const id of [
			BATTERY_CONSUMER_CONSTRAINT_STATES.immersion_heater.allowed,
			BATTERY_CONSUMER_CONSTRAINT_STATES.immersion_heater.reasonDe,
			BATTERY_CONSUMER_CONSTRAINT_STATES.air_conditioning.allowed,
			BATTERY_CONSUMER_CONSTRAINT_STATES.air_conditioning.reasonDe,
			BATTERY_CONSUMER_CONSTRAINT_STATES.wallbox.allowed,
			BATTERY_CONSUMER_CONSTRAINT_STATES.wallbox.reasonDe,
		]) {
			assert.match(publish, new RegExp(id.replace(/\./g, "\\.")));
		}
	});

	it("Admin: Heizstab darf Batterie (ohne nur-kritisch) → allowed true on next tick", async () => {
		resetDailyPlanRevisionForTest();
		const host = mockHost();
		host.states.set("live.battery.soc_pct", 80);
		host.states.set("live.thermal.buffer_temp_c", 44);
		host.states.set("global_modes.active", "balanced");
		const now = new Date("2026-08-19T10:07:00.000Z");
		const fp = forecastForTick(now);

		await runDailyPlanTick(host as never, fp);
		assert.equal(host.states.get("planner.constraints.battery_consumer_immersion_allowed"), false);
		assert.match(
			String(host.states.get("planner.constraints.battery_consumer_immersion_reason_de")),
			/nicht erlaubt/,
		);

		host.config.bat_consumer_immersion_may_use_battery = true;
		host.config.bat_consumer_immersion_only_when_critical = false;
		host.config.bat_consumer_climate_may_use_battery = true;
		host.config.bat_consumer_climate_only_when_critical = false;
		host.config.bat_consumer_wallbox_may_use_battery = true;

		await runDailyPlanTick(host as never, fp);

		assert.equal(host.states.get("planner.constraints.battery_consumer_immersion_allowed"), true);
		assert.match(
			String(host.states.get("planner.constraints.battery_consumer_immersion_reason_de")),
			/freigegeben/,
		);
		assert.equal(host.states.get("planner.constraints.battery_consumer_climate_allowed"), true);
		assert.equal(host.states.get("planner.constraints.battery_consumer_wallbox_allowed"), true);
		assert.equal(host.states.get("planner.global_mode.active"), "balanced");
		assert.equal(host.states.get("planner.status"), "running");
		assert.equal(typeof host.states.get("planner.last_run_at"), "string");
		assert.ok(
			(host.writeCounts.get("planner.constraints.battery_consumer_immersion_allowed") ?? 0) >= 2,
			"same value must still be rewritten so ts stays current",
		);
	});

	it("Admin: nur-kritisch bleibt sichtbar, wenn Puffer nicht kritisch", async () => {
		resetDailyPlanRevisionForTest();
		const host = mockHost({
			bat_consumer_immersion_may_use_battery: true,
			bat_consumer_immersion_only_when_critical: true,
			ih_planning_min_temp_c: 48,
			bat_consumer_immersion_critical_margin_k: 2,
		});
		host.states.set("live.battery.soc_pct", 80);
		host.states.set("live.thermal.buffer_temp_c", 55);
		const now = new Date("2026-08-19T10:07:00.000Z");
		await runDailyPlanTick(host as never, forecastForTick(now));
		assert.equal(host.states.get("planner.constraints.battery_consumer_immersion_allowed"), false);
		assert.match(
			String(host.states.get("planner.constraints.battery_consumer_immersion_reason_de")),
			/Nur-kritisch/,
		);
	});
});
