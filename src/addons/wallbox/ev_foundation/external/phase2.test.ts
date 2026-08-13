import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isLiveWriteAllowed } from "../../../../execution_mode";
import { addonMode, GLOBAL } from "../../../../tree_paths";
import { wallboxEvccTelemetryConfigFromAdapter } from "../../evcc_config";
import { readEvccTelemetrySnapshot, type EvccTelemetryReadHost } from "../../evcc_telemetry";
import { EVCC_READ_CATALOG } from "../catalog";
import { resolveEvCapabilities } from "../capabilities";
import { evFoundationConfigFromAdapter } from "../config";
import { readExternalEvInformation } from "./index";
import { parseSmartPlanPayload } from "./smart_plan_parse";
import { computeExternalPlanRemainingEnergy } from "./remaining_energy";
import { buildEvModelV1, derivePreparedEvModuleState } from "../model";
import {
	EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED,
	EV_FOUNDATION_PLANNER_WRITES_ENABLED,
} from "../write_allowlist";

const NOW = new Date("2026-08-13T10:00:00.000Z");
const SRC = join(__dirname, "..", "..", "..", "..", "..", "src", "addons", "wallbox");

function minEvccAdminConfig(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		wb_evcc_connection_state: EVCC_READ_CATALOG.connection,
		wb_evcc_connected_state: EVCC_READ_CATALOG.connected,
		wb_evcc_charging_state: EVCC_READ_CATALOG.charging,
		wb_evcc_charge_power_w_state: EVCC_READ_CATALOG.chargePower,
		wb_evcc_loadpoint_mode_state: EVCC_READ_CATALOG.mode,
		wb_evcc_active_phases_state: EVCC_READ_CATALOG.phasesActive,
		wb_evcc_configured_phases_state: EVCC_READ_CATALOG.phasesConfigured,
		wb_evcc_max_current_a_state: EVCC_READ_CATALOG.maxCurrent,
		wb_evcc_min_current_a_state: EVCC_READ_CATALOG.minCurrent,
		...over,
	};
}

function minForeign(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		[EVCC_READ_CATALOG.connection]: true,
		[EVCC_READ_CATALOG.connected]: true,
		[EVCC_READ_CATALOG.charging]: false,
		[EVCC_READ_CATALOG.chargePower]: 0,
		[EVCC_READ_CATALOG.mode]: "pv",
		[EVCC_READ_CATALOG.phasesActive]: 1,
		[EVCC_READ_CATALOG.phasesConfigured]: 3,
		[EVCC_READ_CATALOG.maxCurrent]: 16,
		[EVCC_READ_CATALOG.minCurrent]: 6,
		...over,
	};
}

function mockHost(states: Record<string, unknown>, ts = NOW.getTime()): EvccTelemetryReadHost {
	return {
		async getForeignStateAsync(id: string) {
			if (!(id in states)) return null;
			return { val: states[id], ts, lc: ts, ack: true } as ioBroker.State;
		},
		async getStateAsync() {
			return null;
		},
		async setStateAsync() {
			return;
		},
		async setObjectNotExistsAsync() {
			return;
		},
	};
}

async function load(admin: Record<string, unknown>, foreign: Record<string, unknown>) {
	const telemetryCfg = wallboxEvccTelemetryConfigFromAdapter(admin);
	const snap = await readEvccTelemetrySnapshot(mockHost(foreign), telemetryCfg, NOW);
	const foundation = evFoundationConfigFromAdapter(admin);
	const host = mockHost(foreign);
	const external = await readExternalEvInformation(host, foundation, {
		now: NOW,
		fallbackMaxAcKw: foundation.maxAcChargePowerKw,
		configDepartureAt: foundation.departureAt,
		timezone: "UTC",
	});
	const capabilities = resolveEvCapabilities(telemetryCfg, snap, foundation, external);
	const model = buildEvModelV1({ snap, foundation, capabilities, adapterConfig: admin, external });
	return { model, capabilities, external, foundation };
}

const SLOT_PAST = {
	start: "2026-08-13T08:00:00.000Z",
	end: "2026-08-13T09:00:00.000Z",
	plannedPowerKw: 11,
};
const SLOT_CURRENT = {
	start: "2026-08-13T09:30:00.000Z",
	end: "2026-08-13T10:30:00.000Z",
	plannedPowerKw: 11,
};
const SLOT_FUTURE = {
	start: "2026-08-13T12:00:00.000Z",
	end: "2026-08-13T14:00:00.000Z",
	plannedPowerKw: 11,
};

describe("EV foundation Phase 2 — external control & smart plan (read-only)", () => {
	it("T1: EVCC only remains functional without external sources", async () => {
		const { model, capabilities, external } = await load(minEvccAdminConfig(), minForeign());
		assert.equal(capabilities.evccAvailable, true);
		assert.equal(model.vehicleConnected, true);
		assert.equal(model.preparedEvState, "pv");
		assert.equal(external.externalControlConfigured, false);
		assert.equal(external.externalSourceQuality, "unconfigured");
		assert.equal(capabilities.externalSmartPlanAvailable, false);
		assert.equal(model.externalControlActive, null);
		assert.equal(model.gridRewardsActive, null);
		assert.equal(model.externalSmartPlanSlots, null);
		assert.equal(model.emsTakeoverActive, false);
	});

	it("T2: external-control mapped but state missing → unknown, not fake false", async () => {
		const { model, external } = await load(
			minEvccAdminConfig({
				wb_external_control_active_state: "ha.0.control_active",
			}),
			minForeign(),
		);
		assert.equal(external.externalControlConfigured, true);
		assert.equal(model.externalControlActive, null);
		assert.notEqual(model.externalControlActive, false);
		assert.equal(external.externalSourceQuality, "unknown");
	});

	it("T3: externalControlEnabled=true with active=null is valid", async () => {
		const { model } = await load(
			minEvccAdminConfig({
				wb_external_control_type: "vehicle",
				wb_tibber_grid_rewards_vehicle_enabled: true,
			}),
			minForeign(),
		);
		assert.equal(model.externalControlEnabled, true);
		assert.equal(model.externalControlActive, null);
	});

	it("T4: grid-rewards true maps neutrally", async () => {
		const { model } = await load(
			minEvccAdminConfig({
				wb_external_grid_rewards_active_state: "ha.0.grid_rewards",
			}),
			minForeign({ "ha.0.grid_rewards": true }),
		);
		assert.equal(model.gridRewardsActive, true);
		assert.equal(model.externalControlActive, null);
	});

	it("T5: JSON array smart plan parses", async () => {
		const { model, capabilities } = await load(
			minEvccAdminConfig({
				wb_external_smart_plan_state: "ha.0.plan",
			}),
			minForeign({
				"ha.0.plan": [SLOT_FUTURE],
			}),
		);
		assert.equal(capabilities.externalSmartPlanAvailable, true);
		assert.equal(model.externalSmartPlanSlots?.length, 1);
		assert.equal(model.externalSmartPlanSlots?.[0].start, SLOT_FUTURE.start);
		assert.equal(model.externalSmartPlanSlots?.[0].plannedPowerKw, 11);
	});

	it("T6: stringified JSON parses", async () => {
		const parsed = parseSmartPlanPayload(JSON.stringify({ schedule: [SLOT_FUTURE] }));
		assert.equal(parsed.parseable, true);
		assert.equal(parsed.slots.length, 1);
		assert.equal(parsed.slots[0].end, SLOT_FUTURE.end);
	});

	it("T7: invalid plan is degraded/invalid without crash", async () => {
		const { external, capabilities } = await load(
			minEvccAdminConfig({
				wb_external_smart_plan_state: "ha.0.plan",
			}),
			minForeign({ "ha.0.plan": "not-json-and-not-a-plan" }),
		);
		assert.equal(external.smartPlan.payloadParseable, false);
		assert.equal(capabilities.externalSmartPlanAvailable, false);
		assert.ok(["invalid", "degraded"].includes(external.externalSourceQuality));
		assert.equal(external.smartPlan.rawPreview, "not-json-and-not-a-plan");
	});

	it("T8: past slots do not count toward remaining energy", () => {
		const r = computeExternalPlanRemainingEnergy({
			slots: [
				{
					start: SLOT_PAST.start,
					end: SLOT_PAST.end,
					plannedPowerKw: 11,
					plannedEnergyKWh: null,
					source: null,
					quality: "ok",
				},
				{
					start: SLOT_FUTURE.start,
					end: SLOT_FUTURE.end,
					plannedPowerKw: 11,
					plannedEnergyKWh: null,
					source: null,
					quality: "ok",
				},
			],
			nowMs: NOW.getTime(),
			deadlineMs: null,
			fallbackMaxAcKw: null,
		});
		assert.equal(r.remainingEnergyKWh, 22);
	});

	it("T9: running slot counts remaining duration only", () => {
		const r = computeExternalPlanRemainingEnergy({
			slots: [
				{
					start: SLOT_CURRENT.start,
					end: SLOT_CURRENT.end,
					plannedPowerKw: 11,
					plannedEnergyKWh: null,
					source: null,
					quality: "ok",
				},
			],
			nowMs: NOW.getTime(),
			deadlineMs: null,
			fallbackMaxAcKw: null,
		});
		assert.equal(r.remainingEnergyKWh, 5.5);
		assert.equal(r.remainingMinutes, 30);
	});

	it("T10: slots after departureAt do not count", async () => {
		const { model } = await load(
			minEvccAdminConfig({
				wb_external_smart_plan_state: "ha.0.plan",
				wb_ev_departure_at: "2026-08-13T11:00:00.000Z",
			}),
			minForeign({ "ha.0.plan": [SLOT_FUTURE] }),
		);
		assert.equal(model.externalPlanDeadlineUsed, true);
		assert.equal(model.externalPlanRemainingEnergyKWh, 0);
	});

	it("T11: overlapping slots are not double-counted", () => {
		const r = computeExternalPlanRemainingEnergy({
			slots: [
				{
					start: "2026-08-13T10:00:00.000Z",
					end: "2026-08-13T11:00:00.000Z",
					plannedPowerKw: 11,
					plannedEnergyKWh: null,
					source: null,
					quality: "ok",
				},
				{
					start: "2026-08-13T10:30:00.000Z",
					end: "2026-08-13T11:30:00.000Z",
					plannedPowerKw: 11,
					plannedEnergyKWh: null,
					source: null,
					quality: "ok",
				},
			],
			nowMs: NOW.getTime(),
			deadlineMs: null,
			fallbackMaxAcKw: null,
		});
		assert.equal(r.remainingEnergyKWh, 16.5);
	});

	it("T12: plannedEnergyKWh wins over power estimate", () => {
		const r = computeExternalPlanRemainingEnergy({
			slots: [
				{
					start: "2026-08-13T10:00:00.000Z",
					end: "2026-08-13T11:00:00.000Z",
					plannedPowerKw: 11,
					plannedEnergyKWh: 4,
					source: null,
					quality: "ok",
				},
			],
			nowMs: NOW.getTime(),
			deadlineMs: null,
			fallbackMaxAcKw: 22,
		});
		assert.equal(r.remainingEnergyKWh, 4);
		assert.equal(r.estimated, false);
	});

	it("T13: missing slot power uses max AC as marked estimate", async () => {
		const { model, external } = await load(
			minEvccAdminConfig({
				wb_external_smart_plan_state: "ha.0.plan",
				wb_ev_max_ac_charge_power_kw: 11,
			}),
			minForeign({
				"ha.0.plan": [{ start: SLOT_FUTURE.start, end: "2026-08-13T13:00:00.000Z" }],
			}),
		);
		assert.equal(model.externalPlanRemainingEnergyKWh, 11);
		assert.equal(external.smartPlan.remainingEnergyEstimated, true);
	});

	it("T14: no slot energy and no usable power → remaining null", () => {
		const r = computeExternalPlanRemainingEnergy({
			slots: [
				{
					start: SLOT_FUTURE.start,
					end: SLOT_FUTURE.end,
					plannedPowerKw: null,
					plannedEnergyKWh: null,
					source: null,
					quality: "degraded",
				},
			],
			nowMs: NOW.getTime(),
			deadlineMs: null,
			fallbackMaxAcKw: null,
		});
		assert.equal(r.remainingEnergyKWh, null);
		assert.notEqual(r.remainingEnergyKWh, 0);
	});

	it("T15: smart-plan mapped without valid slot → capability false", async () => {
		const { capabilities, external } = await load(
			minEvccAdminConfig({
				wb_external_smart_plan_state: "ha.0.plan",
			}),
			minForeign({ "ha.0.plan": [SLOT_PAST] }),
		);
		assert.equal(external.smartPlan.mappingConfigured, true);
		assert.equal(external.smartPlan.payloadParseable, true);
		assert.equal(external.smartPlan.validPlanPresent, false);
		assert.equal(capabilities.externalSmartPlanAvailable, false);
	});

	it("T16: Ford pause alone does not activate external control", async () => {
		const { model, external } = await load(
			minEvccAdminConfig({
				wb_external_vehicle_charge_state: "ford.0.pause",
			}),
			minForeign({ "ford.0.pause": true }),
		);
		assert.equal(external.vehicleChargePauseDiagnostic, true);
		assert.notEqual(model.externalControlActive, true);
		assert.equal(model.externalControlActive, null);
		assert.equal(model.emsTakeoverActive, false);
	});

	it("T17: no takeover state transition", async () => {
		const { model } = await load(
			minEvccAdminConfig({
				wb_external_control_type: "vehicle",
				wb_external_control_active_state: "ha.0.control_active",
				wb_external_smart_plan_state: "ha.0.plan",
			}),
			minForeign({
				"ha.0.control_active": true,
				"ha.0.plan": [SLOT_FUTURE],
			}),
		);
		assert.equal(model.externalControlActive, true);
		assert.equal(model.preparedEvState, "pv");
		assert.equal(model.emsTakeoverActive, false);
		assert.equal(model.takeoverReason, null);
		assert.ok(!["external", "ems_takeover", "manual_override"].includes(model.preparedEvState));
		assert.equal(derivePreparedEvModuleState("now"), "planned_now");
	});

	it("T18: no new EVCC writes", () => {
		assert.equal(EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
		assert.equal(EV_FOUNDATION_PLANNER_WRITES_ENABLED, false);
		const executeSrc = readFileSync(join(SRC, "runtime", "execute.ts"), "utf8");
		const extSrc = readFileSync(join(SRC, "ev_foundation", "external", "index.ts"), "utf8");
		assert.equal(executeSrc.includes("control.pvControl"), false);
		assert.equal(extSrc.includes("writeForeignIfChanged"), false);
		assert.equal(extSrc.includes("setForeignState"), false);
	});

	it("T19: no HA/Tibber writes", () => {
		const files = [
			join(SRC, "ev_foundation", "external", "index.ts"),
			join(SRC, "ev_foundation", "publish.ts"),
			join(SRC, "ev_foundation", "model.ts"),
		];
		for (const f of files) {
			const src = readFileSync(f, "utf8");
			assert.equal(src.includes("writeForeignIfChanged"), false);
			assert.equal(src.includes("setForeignStateAsync"), false);
		}
	});

	it("T20: governance unchanged", async () => {
		const store: Record<string, string> = {
			[GLOBAL.executionMode]: "dryrun",
			[addonMode("wallbox")]: "live",
		};
		const get = async (id: string) => ({ val: store[id] } as ioBroker.State);
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), false);
		store[GLOBAL.executionMode] = "live";
		store[addonMode("wallbox")] = "dryrun";
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), false);
		store[addonMode("wallbox")] = "live";
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), true);
	});
});

describe("smart-plan parser formats", () => {
	it("parses start/end pair objects and nested dateTime", () => {
		const parsed = parseSmartPlanPayload({
			slots: [
				{
					start: { dateTime: "2026-08-13T12:00:00.000Z" },
					end: { dateTime: "2026-08-13T13:00:00.000Z" },
					powerKw: 7.4,
				},
			],
		});
		assert.equal(parsed.parseable, true);
		assert.equal(parsed.slots[0].plannedPowerKw, 7.4);
	});

	it("ignores unparseable windows instead of inventing them", () => {
		const parsed = parseSmartPlanPayload([{ foo: 1 }, SLOT_FUTURE]);
		assert.equal(parsed.parseable, true);
		assert.equal(parsed.slots.length, 1);
		assert.equal(parsed.ignoredCount, 1);
	});
});
