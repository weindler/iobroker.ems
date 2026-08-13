import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isLiveWriteAllowed } from "../../../execution_mode";
import { addonMode, GLOBAL } from "../../../tree_paths";
import { wallboxEvccTelemetryConfigFromAdapter } from "../evcc_config";
import { readEvccTelemetrySnapshot, type EvccTelemetryReadHost } from "../evcc_telemetry";
import {
	collectConfiguredControlTargetStateIds,
	hasEvccControlWriteMapping,
	resolveEvccControlContractV1,
	resolveWallboxControlModel,
} from "../evcc_control_config";
import { evaluateWallboxDispatchReadiness } from "../runtime/dispatch";
import { buildWallboxControlMappingSnapshot } from "../runtime/control_mapping";
import { EVCC_READ_CATALOG } from "./catalog";
import { resolveEvCapabilities } from "./capabilities";
import { evFoundationConfigFromAdapter, parseOptionalAdminNumber } from "./config";
import { readExternalEvInformation } from "./external";
import { buildEvModelV1 } from "./model";
import { applyEvFoundationIntegration } from "./vehicle_model";
import {
	EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED,
	EV_FOUNDATION_PLANNER_WRITES_ENABLED,
	EVCC_FUTURE_PLANNER_WRITE_SUFFIXES,
	isFuturePlannerWriteAllowed,
} from "./write_allowlist";
import { goeWallboxTemplateFlat } from "../../../mapping_config";

const NOW = new Date("2026-08-13T14:00:00.000Z");
const SRC = join(__dirname, "..", "..", "..", "..", "src", "addons", "wallbox");
const ADMIN_JSON = join(__dirname, "..", "..", "..", "..", "admin", "jsonConfig.json");

function minEvccAdminConfig(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		wb_control_model: "evcc",
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
		[EVCC_READ_CATALOG.mode]: "now",
		[EVCC_READ_CATALOG.phasesActive]: 1,
		[EVCC_READ_CATALOG.phasesConfigured]: 3,
		[EVCC_READ_CATALOG.maxCurrent]: 16,
		[EVCC_READ_CATALOG.minCurrent]: 6,
		...over,
	};
}

function mockHost(
	states: Record<string, unknown>,
	ts = NOW.getTime(),
	lc = ts,
): EvccTelemetryReadHost {
	return {
		async getForeignStateAsync(id: string) {
			if (!(id in states)) return null;
			return { val: states[id], ts, lc, ack: true } as ioBroker.State;
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

async function load(admin: Record<string, unknown>, foreign: Record<string, unknown>, ts = NOW.getTime()) {
	const telemetryCfg = wallboxEvccTelemetryConfigFromAdapter(admin);
	const host = mockHost(foreign, ts);
	const snap = await readEvccTelemetrySnapshot(host, telemetryCfg, NOW);
	const foundation = evFoundationConfigFromAdapter(admin);
	const external = await readExternalEvInformation(host, foundation, {
		now: NOW,
		fallbackMaxAcKw: foundation.maxAcChargePowerKw,
		configDepartureAt: foundation.departureAt,
		timezone: "UTC",
	});
	const capabilities = resolveEvCapabilities(telemetryCfg, snap, foundation, external);
	const built = buildEvModelV1({ snap, foundation, capabilities, adapterConfig: admin, external });
	const model = applyEvFoundationIntegration(built, capabilities, admin);
	return { model, capabilities, external, foundation };
}

function jsonConfigItems(): Record<string, { empty?: boolean; type?: string; validator?: string }> {
	const raw = JSON.parse(readFileSync(ADMIN_JSON, "utf8")) as {
		items?: {
			wallboxTab?: { items?: Record<string, { empty?: boolean; type?: string; validator?: string }> };
		};
	};
	return raw.items?.wallboxTab?.items ?? {};
}

function evalJsonConfigValidator(expr: string, data: Record<string, unknown>): boolean {
	return Boolean(new Function("data", `"use strict"; return (${expr});`)(data));
}

describe("EV foundation v0.1.272 cleanup", () => {
	it("T1: empty minimumDepartureSocPct → null", () => {
		const cfg = evFoundationConfigFromAdapter(
			minEvccAdminConfig({ wb_ev_minimum_departure_soc_pct: "" }),
		);
		assert.equal(cfg.minimumDepartureSocPct, null);
		assert.equal(parseOptionalAdminNumber(""), null);
		assert.equal(parseOptionalAdminNumber(null), null);
		assert.equal(parseOptionalAdminNumber("   "), null);
	});

	it("T2: admin jsonConfig optional EV fields are text so empty does not fail validation", () => {
		const items = jsonConfigItems();
		for (const key of [
			"wb_ev_minimum_departure_soc_pct",
			"wb_ev_target_soc_pct",
			"wb_ev_battery_capacity_kwh",
			"wb_ev_max_ac_charge_power_kw",
			"wb_ev_charging_efficiency",
			"wb_ev_safety_margin_min",
		]) {
			assert.equal(items[key]?.type, "text", `${key} must be text; jsonConfig number cannot be empty`);
			assert.ok(items[key]?.validator, `${key} must validate empty-or-range`);
			assert.equal(
				evalJsonConfigValidator(items[key]!.validator!, { [key]: "" }),
				true,
				`${key} empty string must pass validator`,
			);
			assert.equal(
				evalJsonConfigValidator(items[key]!.validator!, { [key]: null }),
				true,
				`${key} null must pass validator`,
			);
		}
		assert.equal(
			evalJsonConfigValidator(items.wb_ev_minimum_departure_soc_pct!.validator!, {
				wb_ev_minimum_departure_soc_pct: "abc",
			}),
			false,
		);
		assert.equal(
			evalJsonConfigValidator(items.wb_ev_target_soc_pct!.validator!, { wb_ev_target_soc_pct: "90" }),
			true,
		);
	});

	it("T3: empty optional number does not become 0", () => {
		const cfg = evFoundationConfigFromAdapter(
			minEvccAdminConfig({
				wb_ev_minimum_departure_soc_pct: "",
				wb_ev_battery_capacity_kwh: "",
				wb_ev_max_ac_charge_power_kw: null,
				wb_ev_charging_efficiency: "  ",
				wb_ev_safety_margin_min: undefined,
			}),
		);
		assert.equal(cfg.minimumDepartureSocPct, null);
		assert.equal(cfg.batteryCapacityKWh, null);
		assert.equal(cfg.maxAcChargePowerKw, null);
		assert.equal(cfg.chargingEfficiency, null);
		assert.equal(cfg.safetyMarginMin, null);
		assert.notEqual(cfg.minimumDepartureSocPct, 0);
		assert.notEqual(cfg.batteryCapacityKWh, 0);
	});

	it("T4: target SOC 90 with departure min null is valid", async () => {
		const { model } = await load(
			minEvccAdminConfig({
				wb_ev_target_soc_pct: 90,
				wb_ev_minimum_departure_soc_pct: "",
				wb_ev_departure_at: "",
			}),
			minForeign(),
		);
		assert.equal(model.targetSocPct, 90);
		assert.equal(model.minimumDepartureSocPct, null);
		assert.equal(model.departureMinSocConfigured, false);
		assert.equal(model.departureAt, null);
	});

	it("T5: Tibber/external min SOC 25 is not departure min", async () => {
		const { model, external } = await load(
			minEvccAdminConfig({
				wb_ev_target_soc_pct: 90,
				wb_external_smart_charging_min_soc_state: "ha.0.tibber_min_soc",
			}),
			minForeign({ "ha.0.tibber_min_soc": 25 }),
		);
		assert.equal(external.externalSmartChargingMinSocPct, 25);
		assert.equal(model.externalSmartChargingMinSocPct, 25);
		assert.equal(model.minimumDepartureSocPct, null);
		assert.equal(model.departureMinSocConfigured, false);
		assert.notEqual(model.minimumDepartureSocPct, 25);
	});

	it("T6: boolean grid-rewards state is not stale from unchanged age", async () => {
		const oldTs = NOW.getTime() - 6 * 60 * 60 * 1000;
		const { model, external } = await load(
			minEvccAdminConfig({
				wb_external_grid_rewards_active_state: "ha.0.grid_rewards",
			}),
			minForeign({ "ha.0.grid_rewards": false }),
			oldTs,
		);
		assert.equal(model.gridRewardsActive, false);
		assert.notEqual(model.externalSourceQuality, "stale");
		assert.equal(external.freshnessSignalConfigured, false);
		assert.ok(model.externalSourceQuality === "ok" || model.externalSourceQuality === "unknown");
	});

	it("T7: explicit heartbeat/freshness can still become stale", async () => {
		const oldTs = NOW.getTime() - 2 * 60 * 60 * 1000;
		const { model } = await load(
			minEvccAdminConfig({
				wb_external_grid_rewards_active_state: "ha.0.grid_rewards",
				wb_external_source_updated_at_state: "ha.0.heartbeat",
				wb_external_source_stale_after_min: 30,
			}),
			minForeign({
				"ha.0.grid_rewards": false,
				"ha.0.heartbeat": "2026-08-13T11:00:00.000Z",
			}),
			oldTs,
		);
		assert.equal(model.gridRewardsActive, false);
		assert.equal(model.externalSourceQuality, "stale");
		assert.equal(model.emsTakeoverActive, false);
	});

	it("T8: EVCC control model does not fall back to go-e mappings", () => {
		const cfg = {
			wb_control_model: "evcc",
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_current_a_target: "go-e.0.amperePV",
			wb_set_phase_switch_target: "go-e.0.phaseSwitchModeEnabled",
			wb_evcc_control_pv_control_target: "evcc.0.loadpoint.1.control.pvControl",
			wb_evcc_control_max_current_target: "evcc.0.loadpoint.1.control.maxCurrent",
			wb_evcc_control_phases_configured_target: "evcc.0.loadpoint.1.control.phasesConfigured",
		};
		const contract = resolveEvccControlContractV1(cfg);
		assert.equal(contract.ready, true);
		assert.equal(contract.usesLegacyGoeFallback, false);
		assert.equal(contract.pvControlStateId.startsWith("go-e."), false);
		const ids = collectConfiguredControlTargetStateIds(cfg);
		assert.ok(ids.every((id) => !id.startsWith("go-e.")));
		const snap = buildWallboxControlMappingSnapshot({
			config: cfg,
			telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: "" },
			objectMetas: {},
		});
		assert.equal(snap.controlModel, "evcc");
		assert.equal(snap.setCurrentA, null);
		assert.equal(snap.setEnabled, null);
		assert.equal(snap.evccControlContractReady, true);
		assert.equal(snap.liveEligible, false);
	});

	it("T9: legacy go-e mappings remain for legacy_direct", () => {
		const tpl = goeWallboxTemplateFlat();
		assert.equal(tpl.wb_set_current_a_target, "go-e.0.amperePV");
		assert.equal(tpl.wb_set_enabled_target, "go-e.0.allow_charging");
		const r = evaluateWallboxDispatchReadiness({
			wb_control_model: "legacy_direct",
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_current_a_target: "go-e.0.amperePV",
		});
		assert.equal(r.controlMappingComplete, true);
		assert.equal(resolveWallboxControlModel({ wb_control_model: "legacy_direct" }), "legacy_direct");
	});

	it("T10: EVCC write allowlist remains pvControl/maxCurrent/phasesConfigured", () => {
		assert.deepEqual([...EVCC_FUTURE_PLANNER_WRITE_SUFFIXES], [
			"control.pvControl",
			"control.maxCurrent",
			"control.phasesConfigured",
		]);
		assert.equal(isFuturePlannerWriteAllowed("evcc.0.loadpoint.1.control.pvControl"), true);
		assert.equal(isFuturePlannerWriteAllowed("evcc.0.loadpoint.1.control.limitSoc"), false);
		assert.equal(isFuturePlannerWriteAllowed("go-e.0.amperePV"), false);
	});

	it("T11: no new productive EVCC writes", () => {
		assert.equal(EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
		assert.equal(EV_FOUNDATION_PLANNER_WRITES_ENABLED, false);
		const executeSrc = readFileSync(join(SRC, "runtime", "execute.ts"), "utf8");
		assert.equal(executeSrc.includes("control.pvControl"), false);
		const cfg = {
			wb_control_model: "evcc",
			wb_evcc_control_pv_control_target: "evcc.0.loadpoint.1.control.pvControl",
			wb_evcc_control_max_current_target: "evcc.0.loadpoint.1.control.maxCurrent",
			wb_evcc_control_phases_configured_target: "evcc.0.loadpoint.1.control.phasesConfigured",
		};
		assert.equal(resolveEvccControlContractV1(cfg).ready, true);
		const readiness = evaluateWallboxDispatchReadiness(cfg);
		assert.equal(readiness.controlMappingComplete, true);
		assert.equal(readiness.liveDispatchSupported, false);
		assert.equal(hasEvccControlWriteMapping(cfg), true);
	});

	it("T12: no Sonnen writes", () => {
		const files = [
			join(SRC, "ev_foundation", "external", "index.ts"),
			join(SRC, "ev_foundation", "publish.ts"),
			join(SRC, "ev_foundation", "model.ts"),
			join(SRC, "runtime", "execute.ts"),
		];
		for (const f of files) {
			const src = readFileSync(f, "utf8");
			assert.equal(src.includes("batteryMode"), false, f);
			assert.equal(src.includes("batteryDischargeControl"), false, f);
		}
	});

	it("T13: no takeover from now/charging=false", async () => {
		const { model } = await load(minEvccAdminConfig(), minForeign());
		assert.equal(model.preparedEvState, "planned_now");
		assert.equal(model.charging, false);
		assert.equal(model.emsTakeoverActive, false);
		assert.equal(model.takeoverReason, null);
		assert.ok(!["external", "ems_takeover", "manual_override"].includes(model.preparedEvState));
	});

	it("T14: foundation remains usable with EVCC min config", async () => {
		const { model, capabilities } = await load(minEvccAdminConfig(), minForeign());
		assert.equal(capabilities.evccAvailable, true);
		assert.equal(model.vehicleConnected, true);
		assert.equal(model.dataQuality, "ok");
		assert.equal(model.vehicleModelSource, "ev_model_v1");
		assert.equal(model.vehicleModelReady, true);
	});

	it("T15: missing vehicle profiles do not blanket-block foundation", async () => {
		const { model } = await load(
			minEvccAdminConfig({ wb_vehicle_profiles: [] }),
			minForeign(),
		);
		assert.equal(model.vehicleModelReady, true);
		assert.equal(model.vehicleModelSource, "ev_model_v1");
		assert.notEqual(model.dataQuality, "unknown");
	});

	it("T16: governance unchanged", async () => {
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
