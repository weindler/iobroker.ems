import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isLiveWriteAllowed } from "../../../execution_mode";
import { addonMode, GLOBAL } from "../../../tree_paths";
import { WALLBOX_EVCC_CONTROL_ROLES } from "../evcc_control_config";
import { emptyWallboxEvccTelemetryConfig, wallboxEvccTelemetryConfigFromAdapter } from "../evcc_config";
import { readEvccTelemetrySnapshot, type EvccTelemetryReadHost } from "../evcc_telemetry";
import { EVCC_READ_CATALOG } from "./catalog";
import { resolveEvCapabilities } from "./capabilities";
import { evFoundationConfigFromAdapter } from "./config";
import { buildEvModelV1, derivePreparedEvModuleState } from "./model";
import {
	EV_MODULE_STATES,
	EV_TAKEOVER_REASONS,
} from "./types";
import {
	classifyEvccPlannerWriteTarget,
	encodePhasesConfiguredWrite,
	encodePvControl,
	EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED,
	EVCC_FUTURE_PLANNER_WRITE_SUFFIXES,
	EVCC_PLANNER_WRITE_TABOO_SUFFIXES,
	EVCC_PHASES_CONFIGURED_WRITE,
	EVCC_PV_CONTROL,
	isFuturePlannerWriteAllowed,
	isPlannerWriteTaboo,
} from "./write_allowlist";

const NOW = new Date("2026-08-13T10:00:00.000Z");
const SRC = join(__dirname, "..", "..", "..", "..", "src", "addons", "wallbox");

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

function mockHost(states: Record<string, unknown>): EvccTelemetryReadHost {
	return {
		async getForeignStateAsync(id: string) {
			if (!(id in states)) return null;
			return { val: states[id], ts: Date.now(), ack: true } as ioBroker.State;
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

async function modelFrom(admin: Record<string, unknown>, foreign: Record<string, unknown>) {
	const telemetryCfg = wallboxEvccTelemetryConfigFromAdapter(admin);
	const snap = await readEvccTelemetrySnapshot(mockHost(foreign), telemetryCfg, NOW);
	const foundation = evFoundationConfigFromAdapter(admin);
	const capabilities = resolveEvCapabilities(telemetryCfg, snap, foundation);
	const model = buildEvModelV1({ snap, foundation, capabilities, adapterConfig: admin });
	return { telemetryCfg, snap, foundation, capabilities, model };
}

describe("EV foundation Phase 1", () => {
	it("T1: EVCC min config without HA/Tibber works", async () => {
		const { model, capabilities } = await modelFrom(minEvccAdminConfig(), {
			[EVCC_READ_CATALOG.connection]: true,
			[EVCC_READ_CATALOG.connected]: true,
			[EVCC_READ_CATALOG.charging]: false,
			[EVCC_READ_CATALOG.chargePower]: 0,
			[EVCC_READ_CATALOG.mode]: "pv",
			[EVCC_READ_CATALOG.phasesActive]: 1,
			[EVCC_READ_CATALOG.phasesConfigured]: 3,
			[EVCC_READ_CATALOG.maxCurrent]: 16,
			[EVCC_READ_CATALOG.minCurrent]: 6,
		});
		assert.equal(capabilities.evccAvailable, true);
		assert.equal(capabilities.homeAssistantDataSourceAvailable, false);
		assert.equal(capabilities.tibberGridRewardsViaVehicle, false);
		assert.equal(capabilities.tibberGridRewardsViaWallbox, false);
		assert.equal(model.vehicleConnected, true);
		assert.equal(model.charging, false);
		assert.equal(model.evccMode, "pv");
		assert.equal(model.preparedEvState, "pv");
		assert.equal(model.emsTakeoverActive, false);
		assert.equal(model.takeoverReason, null);
	});

	it("T2: missing vehicle SOC is unknown, not a fake value", async () => {
		const { model, capabilities, snap } = await modelFrom(minEvccAdminConfig(), {
			[EVCC_READ_CATALOG.connection]: true,
			[EVCC_READ_CATALOG.connected]: true,
			[EVCC_READ_CATALOG.charging]: false,
			[EVCC_READ_CATALOG.chargePower]: 0,
			[EVCC_READ_CATALOG.mode]: "off",
			[EVCC_READ_CATALOG.phasesActive]: 0,
			[EVCC_READ_CATALOG.phasesConfigured]: 3,
			[EVCC_READ_CATALOG.maxCurrent]: 16,
			[EVCC_READ_CATALOG.minCurrent]: 6,
		});
		assert.equal(snap.vehicle_soc_pct.status, "missing");
		assert.equal(snap.vehicle_soc_pct.value, null);
		assert.equal(model.vehicleSocPct, null);
		assert.equal(model.vehicleSocQuality, "unknown");
		assert.equal(capabilities.vehicleSocAvailable, false);
		assert.notEqual(model.vehicleSocPct, 0);
	});

	it("T3: connected=true and charging=false stay distinct", async () => {
		const { model } = await modelFrom(minEvccAdminConfig(), {
			[EVCC_READ_CATALOG.connection]: true,
			[EVCC_READ_CATALOG.connected]: true,
			[EVCC_READ_CATALOG.charging]: false,
			[EVCC_READ_CATALOG.chargePower]: 0,
			[EVCC_READ_CATALOG.mode]: "pv",
			[EVCC_READ_CATALOG.phasesActive]: 0,
			[EVCC_READ_CATALOG.phasesConfigured]: 1,
			[EVCC_READ_CATALOG.maxCurrent]: 16,
			[EVCC_READ_CATALOG.minCurrent]: 6,
		});
		assert.equal(model.vehicleConnected, true);
		assert.equal(model.charging, false);
		assert.notEqual(model.vehicleConnected, model.charging);
	});

	it("T4: vehicleDetectionActive=false does not override connected=true", async () => {
		const { model, snap } = await modelFrom(
			minEvccAdminConfig({
				wb_evcc_vehicle_detection_active_state: EVCC_READ_CATALOG.vehicleDetectionActive,
			}),
			{
				[EVCC_READ_CATALOG.connection]: true,
				[EVCC_READ_CATALOG.connected]: true,
				[EVCC_READ_CATALOG.charging]: false,
				[EVCC_READ_CATALOG.chargePower]: 0,
				[EVCC_READ_CATALOG.mode]: "pv",
				[EVCC_READ_CATALOG.phasesActive]: 1,
				[EVCC_READ_CATALOG.phasesConfigured]: 3,
				[EVCC_READ_CATALOG.maxCurrent]: 16,
				[EVCC_READ_CATALOG.minCurrent]: 6,
				[EVCC_READ_CATALOG.vehicleDetectionActive]: false,
			},
		);
		assert.equal(snap.vehicle_detection_active.value, false);
		assert.equal(model.vehicleDetectionActive, false);
		assert.equal(model.vehicleConnected, true);
	});

	it("T5: phasesConfigured and phasesActive stay separate", async () => {
		const { model } = await modelFrom(minEvccAdminConfig(), {
			[EVCC_READ_CATALOG.connection]: true,
			[EVCC_READ_CATALOG.connected]: true,
			[EVCC_READ_CATALOG.charging]: true,
			[EVCC_READ_CATALOG.chargePower]: 2300,
			[EVCC_READ_CATALOG.mode]: "minpv",
			[EVCC_READ_CATALOG.phasesActive]: 1,
			[EVCC_READ_CATALOG.phasesConfigured]: 3,
			[EVCC_READ_CATALOG.maxCurrent]: 16,
			[EVCC_READ_CATALOG.minCurrent]: 6,
		});
		assert.equal(model.phasesConfigured, 3);
		assert.equal(model.phasesActive, 1);
		assert.notEqual(model.phasesConfigured, model.phasesActive);
		assert.equal(model.preparedEvState, "minpv");
	});

	it("T6: missing smart-plan capability is not an error", async () => {
		const { capabilities, model } = await modelFrom(minEvccAdminConfig(), {
			[EVCC_READ_CATALOG.connection]: true,
			[EVCC_READ_CATALOG.connected]: false,
			[EVCC_READ_CATALOG.charging]: false,
			[EVCC_READ_CATALOG.chargePower]: 0,
			[EVCC_READ_CATALOG.mode]: "off",
			[EVCC_READ_CATALOG.phasesActive]: 0,
			[EVCC_READ_CATALOG.phasesConfigured]: 3,
			[EVCC_READ_CATALOG.maxCurrent]: 16,
			[EVCC_READ_CATALOG.minCurrent]: 6,
		});
		assert.equal(capabilities.externalSmartPlanAvailable, false);
		assert.equal(model.externalSmartPlanAvailable, false);
		assert.equal(model.externalSmartPlanSlots, null);
		assert.equal(model.externalPlanRemainingEnergyKWh, null);
		assert.equal(model.dataQuality === "ok" || model.dataQuality === "degraded", true);
	});

	it("T7: missing Ford/Tibber/HA still yields a working EV model", async () => {
		const admin = minEvccAdminConfig();
		assert.equal("wb_tibber_grid_rewards_active_state" in admin, false);
		assert.equal("wb_external_vehicle_charge_state" in admin, false);
		assert.equal("wb_ha_data_source_enabled" in admin, false);
		const { model, capabilities } = await modelFrom(admin, {
			[EVCC_READ_CATALOG.connection]: true,
			[EVCC_READ_CATALOG.connected]: true,
			[EVCC_READ_CATALOG.charging]: true,
			[EVCC_READ_CATALOG.chargePower]: 11000,
			[EVCC_READ_CATALOG.mode]: "now",
			[EVCC_READ_CATALOG.phasesActive]: 3,
			[EVCC_READ_CATALOG.phasesConfigured]: 3,
			[EVCC_READ_CATALOG.maxCurrent]: 16,
			[EVCC_READ_CATALOG.minCurrent]: 6,
		});
		assert.equal(capabilities.evccAvailable, true);
		assert.equal(capabilities.homeAssistantDataSourceAvailable, false);
		assert.equal(model.preparedEvState, "planned_now");
		assert.equal(model.externalControlActive, null);
		assert.equal(model.gridRewardsActive, null);
		assert.equal(model.manualOverrideActive, null);
		assert.ok(!Object.keys(model).some((k) => k.toLowerCase().includes("ford")));
		assert.ok(!Object.keys(capabilities).some((k) => k.toLowerCase().includes("ford")));
	});

	it("T8: future write allowlist contains only the three control states", () => {
		assert.deepEqual([...EVCC_FUTURE_PLANNER_WRITE_SUFFIXES].sort(), [
			"control.maxCurrent",
			"control.phasesConfigured",
			"control.pvControl",
		]);
		assert.equal(isFuturePlannerWriteAllowed("evcc.0.loadpoint.1.control.pvControl"), true);
		assert.equal(isFuturePlannerWriteAllowed("evcc.0.loadpoint.1.control.maxCurrent"), true);
		assert.equal(isFuturePlannerWriteAllowed("evcc.0.loadpoint.1.control.phasesConfigured"), true);
		assert.equal(encodePvControl("off"), EVCC_PV_CONTROL.off);
		assert.equal(encodePvControl("pv"), 1);
		assert.equal(encodePvControl("min"), 2);
		assert.equal(encodePvControl("now"), 3);
		assert.equal(encodePhasesConfiguredWrite("auto"), EVCC_PHASES_CONFIGURED_WRITE.auto);
		assert.equal(encodePhasesConfiguredWrite("1p"), 1);
		assert.equal(encodePhasesConfiguredWrite("3p"), 3);
	});

	it("T9: taboo states are not written in this phase", () => {
		assert.equal(EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
		for (const suffix of EVCC_PLANNER_WRITE_TABOO_SUFFIXES) {
			assert.equal(isPlannerWriteTaboo(`evcc.0.loadpoint.1.${suffix}`), true);
			assert.equal(isFuturePlannerWriteAllowed(`evcc.0.loadpoint.1.${suffix}`), false);
			assert.equal(classifyEvccPlannerWriteTarget(`evcc.0.loadpoint.1.${suffix}`), "taboo");
		}
		assert.deepEqual([...WALLBOX_EVCC_CONTROL_ROLES], ["set_mode", "set_max_current_a", "set_phase"]);

		const executeSrc = readFileSync(join(SRC, "runtime", "execute.ts"), "utf8");
		const writePlanSrc = readFileSync(join(SRC, "runtime", "write_plan.ts"), "utf8");
		const publishSrc = readFileSync(join(SRC, "ev_foundation", "publish.ts"), "utf8");
		const modelSrc = readFileSync(join(SRC, "ev_foundation", "model.ts"), "utf8");
		for (const src of [executeSrc, writePlanSrc, publishSrc, modelSrc]) {
			assert.equal(src.includes("control.limitSoc"), false);
			assert.equal(src.includes("control.smartCostLimit"), false);
			assert.equal(src.includes("control.enableThreshold"), false);
			assert.equal(src.includes("control.disableThreshold"), false);
			assert.equal(src.includes("writeForeignIfChanged"), src === executeSrc);
		}
		assert.equal(writePlanSrc.includes("ev_foundation/write_allowlist"), false);
		assert.equal(executeSrc.includes("control.pvControl"), false);
	});

	it("T10: global/add-on governance is unchanged", async () => {
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

		const execModeSrc = readFileSync(join(SRC, "..", "..", "execution_mode.ts"), "utf8");
		assert.match(execModeSrc, /parseGlobalMode\(global\?\.val\) !== "live"/);
		assert.match(execModeSrc, /parseAddonMode\(addon\?\.val\) === "live"/);
	});
});

describe("EV foundation helpers", () => {
	it("prepared module states and takeover reasons exist as types only", () => {
		assert.deepEqual([...EV_MODULE_STATES], [
			"idle",
			"pv",
			"minpv",
			"planned_now",
			"external",
			"ems_takeover",
			"manual_override",
		]);
		assert.deepEqual([...EV_TAKEOVER_REASONS], [
			"deadline_risk",
			"insufficient_external_plan",
			"economic_window_loss",
			"external_unavailable",
		]);
		assert.equal(derivePreparedEvModuleState("now"), "planned_now");
		assert.equal(derivePreparedEvModuleState("off"), "idle");
		assert.ok(!["external", "ems_takeover", "manual_override"].includes(derivePreparedEvModuleState("now")));
	});

	it("empty telemetry config has no invented mappings", () => {
		const empty = emptyWallboxEvccTelemetryConfig();
		assert.equal(empty.vehicleSocStateId, "");
		assert.equal(empty.connectionStateId, "");
		const cfg = evFoundationConfigFromAdapter({});
		assert.equal(cfg.evccIntegrationEnabled, true);
		assert.equal(cfg.batteryCapacityKWh, null);
		assert.equal(cfg.chargingEfficiency, null);
		assert.equal(cfg.externalControlType, "none");
	});
});
