import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAllowlistedCleanupRelativeId } from "./allowlist.js";
import { runDynamicSurfaceCleanup, type SurfaceCleanupHost } from "./cleanup.js";
import { ensureAcRuntimeStates } from "../addons/air_conditioning/runtime/ensure_states.js";
import { ensureAddonMappingStates } from "../mapping_sync.js";
import { acMappingCommands, acMappingCommandsForConfiguredUnits } from "../addons/air_conditioning/mapping_config.js";
import { AC_ADDON_ID } from "../addons/air_conditioning/constants.js";
import { ensureWallboxVehicleProfileStates } from "../addons/wallbox/vehicles/ensure_states.js";
import { normalizeWallboxVehicleProfiles } from "../addons/wallbox/vehicles/normalize.js";
import { wallboxVehicleProfilesConfigFromAdapter } from "../addons/wallbox/vehicles/config.js";
// ensure/normalize kept only to plant legacy fat trees for purge assertions

class FakeCleanupHost implements SurfaceCleanupHost {
	readonly namespace = "ems.0";
	readonly objects = new Map<string, ioBroker.Object>();
	config: unknown;
	deleted: string[] = [];

	constructor(config: unknown = {}) {
		this.config = config;
	}

	log = {
		info: () => undefined,
		warn: () => undefined,
		debug: () => undefined,
	};

	async setObjectNotExistsAsync(id: string, obj: ioBroker.Object): Promise<void> {
		if (!this.objects.has(id)) {
			this.objects.set(id, { ...obj, _id: id } as ioBroker.Object);
		}
	}

	async getStateAsync(): Promise<null> {
		return null;
	}

	async setStateAsync(): Promise<void> {
		/* noop */
	}

	async getObjectAsync(id: string): Promise<ioBroker.Object | null> {
		return this.objects.get(id) ?? null;
	}

	async delObjectAsync(id: string, options?: { recursive?: boolean }): Promise<void> {
		this.deleted.push(id);
		if (options?.recursive) {
			const prefix = `${id}.`;
			for (const key of [...this.objects.keys()]) {
				if (key === id || key.startsWith(prefix)) {
					this.objects.delete(key);
				}
			}
			return;
		}
		this.objects.delete(id);
	}

	listRelativeObjectIds(): string[] {
		return [...this.objects.keys()];
	}
}

describe("surface cleanup allowlist", () => {
	it("allows AC/vehicle roots and lean planner purge roots", () => {
		assert.equal(isAllowlistedCleanupRelativeId("addons.air_conditioning.units.unit_3"), true);
		assert.equal(
			isAllowlistedCleanupRelativeId("addons.air_conditioning.mapping.unit_2_cmd_switch_on"),
			true,
		);
		assert.equal(
			isAllowlistedCleanupRelativeId("addons.air_conditioning.mapping.unit_3_cmd_switch_on.enabled"),
			true,
		);
		assert.equal(isAllowlistedCleanupRelativeId("addons.wallbox.vehicles.ford_explorer"), true);
		assert.equal(isAllowlistedCleanupRelativeId("planner.authority"), true);
		assert.equal(isAllowlistedCleanupRelativeId("planner.takeover"), true);
		assert.equal(isAllowlistedCleanupRelativeId("planner.coordinator"), true);
		assert.equal(isAllowlistedCleanupRelativeId("planner.intent.forecast_plan"), false);
		assert.equal(isAllowlistedCleanupRelativeId("planner.intent.daily_plan"), false);
		assert.equal(isAllowlistedCleanupRelativeId("planner.intent.allocation"), false);
		assert.equal(isAllowlistedCleanupRelativeId("planner.intent.allocation.wallbox.plan_json"), false);
		assert.equal(isAllowlistedCleanupRelativeId("learning.persistence.pv_bias_daily_json"), true);
		assert.equal(isAllowlistedCleanupRelativeId("learning.persistence.files_present"), false);
		assert.equal(isAllowlistedCleanupRelativeId("addons.sensorics"), true);
		assert.equal(isAllowlistedCleanupRelativeId("addons.sensorics.enabled"), true);
		assert.equal(isAllowlistedCleanupRelativeId("addons.wallbox.mapping.evcc_connected.allowed_values"), true);
		assert.equal(isAllowlistedCleanupRelativeId("info.backup.export_register_ready"), true);
		assert.equal(isAllowlistedCleanupRelativeId("addons.wallbox.runtime.dispatch_intent_json"), true);
		assert.equal(isAllowlistedCleanupRelativeId("addons.wallbox.runtime.connected"), true);
		assert.equal(isAllowlistedCleanupRelativeId("addons.wallbox.runtime.detail_json"), false);
		assert.equal(isAllowlistedCleanupRelativeId("addons.battery.mapping.soc_pct.target_state"), true);
		assert.equal(isAllowlistedCleanupRelativeId("planner.intent.forecast_plan.plan_json"), true);
		assert.equal(isAllowlistedCleanupRelativeId("learning.thermal_boiler.history_json"), true);
		assert.equal(isAllowlistedCleanupRelativeId("user_intent.resolved_all_json"), true);
		assert.equal(isAllowlistedCleanupRelativeId("user_intent.wallbox.resolved_json"), false);
		assert.equal(isAllowlistedCleanupRelativeId("ems.0.addons.air_conditioning.units.unit_1"), false);
		assert.equal(isAllowlistedCleanupRelativeId("alias.0.foo"), false);
	});
});

describe("dynamic surface ensure + cleanup", () => {
	it("fresh install with empty config creates no AC unit folders", async () => {
		const host = new FakeCleanupHost({});
		await ensureAddonMappingStates(host, AC_ADDON_ID, acMappingCommandsForConfiguredUnits(host.config));
		await ensureAcRuntimeStates(host);
		const unitKeys = [...host.objects.keys()].filter((k) =>
			k.startsWith("addons.air_conditioning.units.unit_"),
		);
		assert.equal(unitKeys.length, 0);
		assert.ok(host.objects.has("addons.air_conditioning.units"));
		assert.ok(host.objects.has("addons.air_conditioning.runtime"));
	});

	it("creates only enabled units, not disabled with leftover mappings", async () => {
		const host = new FakeCleanupHost({
			ac_u1_enabled: true,
			ac_u2_enabled: true,
			ac_u3_enabled: false,
			ac_u3_feedback_switch_target: "smartthings.0.x.switch",
		});
		await ensureAddonMappingStates(host, AC_ADDON_ID, acMappingCommandsForConfiguredUnits(host.config));
		await ensureAcRuntimeStates(host);
		assert.ok(host.objects.has("addons.air_conditioning.units.unit_1"));
		assert.ok(host.objects.has("addons.air_conditioning.units.unit_2"));
		assert.equal(host.objects.has("addons.air_conditioning.units.unit_3"), false);
	});

	it("upgrade cleanup removes unconfigured AC placeholders and is idempotent", async () => {
		const host = new FakeCleanupHost({});
		// Simulate pre-4B1 over-ensure
		await ensureAddonMappingStates(host, AC_ADDON_ID, acMappingCommands());
		await ensureAcRuntimeStates({
			...host,
			config: undefined,
			setObjectNotExistsAsync: host.setObjectNotExistsAsync.bind(host),
		}, { unitIndexes: [1, 2, 3, 4, 5] });
		assert.ok(host.objects.has("addons.air_conditioning.units.unit_5"));
		assert.ok(
			host.objects.has("addons.air_conditioning.mapping.unit_5_cmd_switch_on.enabled"),
		);

		host.config = { ac_u1_enabled: true };
		const first = await runDynamicSurfaceCleanup(host);
		assert.ok(first.deleted > 0);
		assert.ok(host.objects.has("addons.air_conditioning.units.unit_1"));
		assert.equal(host.objects.has("addons.air_conditioning.units.unit_5"), false);
		assert.equal(
			host.objects.has("addons.air_conditioning.mapping.unit_5_cmd_switch_on.enabled"),
			false,
		);
		assert.equal(
			host.objects.has("addons.air_conditioning.mapping.unit_1_cmd_switch_on.enabled"),
			false,
		);
		assert.equal(
			host.objects.has("addons.air_conditioning.mapping.unit_3_cmd_cleaning_mode.target_state"),
			false,
		);

		const before = host.objects.size;
		const second = await runDynamicSurfaceCleanup(host);
		assert.equal(second.deleted, 0);
		assert.equal(host.objects.size, before);
	});

	it("deletes disabled unit that only has leftover mapping targets", async () => {
		const host = new FakeCleanupHost({
			ac_u1_enabled: false,
			ac_u1_room_temp_target: "temp.0.x",
		});
		await ensureAcRuntimeStates(host, { unitIndexes: [1] });
		const stats = await runDynamicSurfaceCleanup(host);
		assert.equal(host.objects.has("addons.air_conditioning.units.unit_1"), false);
		assert.ok(host.deleted.includes("addons.air_conditioning.units.unit_1"));
		assert.ok(stats.deleted >= 1);
	});

	it("empty vehicle mini-map creates no profile folders; legacy fat trees are purged", async () => {
		const host = new FakeCleanupHost({ wb_vehicle_map: [] });
		assert.equal(
			[...host.objects.keys()].some((k) => /^addons\.wallbox\.vehicles\.[^./]+$/.test(k)),
			false,
		);

		const { profiles } = normalizeWallboxVehicleProfiles(
			wallboxVehicleProfilesConfigFromAdapter({
				wb_vehicle_profiles: [{ vehicle_id: "old_car", display_name: "Old", enabled: false }],
			}).profiles,
			new Date().toISOString(),
		);
		await ensureWallboxVehicleProfileStates(host, profiles);
		assert.ok(host.objects.has("addons.wallbox.vehicles.old_car"));

		host.config = { wb_vehicle_map: [] };
		await runDynamicSurfaceCleanup(host);
		assert.equal(host.objects.has("addons.wallbox.vehicles.old_car"), false);
	});

	it("purges legacy fat vehicle folders even if mini-map has entries", async () => {
		const cfg = {
			wb_vehicle_map: [{ evcc_vehicle_id: "garage", display_name: "Garage", enabled: true }],
		};
		const host = new FakeCleanupHost(cfg);
		const { profiles } = normalizeWallboxVehicleProfiles(
			wallboxVehicleProfilesConfigFromAdapter({
				wb_vehicle_profiles: [{ vehicle_id: "garage_car", display_name: "Garage", enabled: false }],
			}).profiles,
			new Date().toISOString(),
		);
		await ensureWallboxVehicleProfileStates(host, profiles);
		await runDynamicSurfaceCleanup(host);
		assert.equal(host.objects.has("addons.wallbox.vehicles.garage_car"), false);
	});

	it("never deletes compatibility prefixes even if present", async () => {
		const host = new FakeCleanupHost({});
		await host.setObjectNotExistsAsync("planner.intent.allocation.wallbox.plan_json", {
			type: "state",
			common: { name: "x", type: "string", role: "json", read: true, write: false },
			native: {},
		} as ioBroker.Object);
		await runDynamicSurfaceCleanup(host);
		assert.ok(host.objects.has("planner.intent.allocation.wallbox.plan_json"));
	});

	it("state budget: configured-only AC ensure is smaller than full 5-slot ensure", async () => {
		const empty = new FakeCleanupHost({});
		await ensureAcRuntimeStates(empty);
		const emptyCount = empty.objects.size;

		const one = new FakeCleanupHost({ ac_u1_enabled: true });
		await ensureAcRuntimeStates(one);
		const oneCount = one.objects.size;

		const legacy = new FakeCleanupHost({});
		await ensureAddonMappingStates(legacy, AC_ADDON_ID, acMappingCommands());
		await ensureAcRuntimeStates(legacy, { unitIndexes: [1, 2, 3, 4, 5] });
		const legacyCount = legacy.objects.size;

		assert.ok(emptyCount < oneCount);
		assert.ok(oneCount < legacyCount);
		const savingsVsLegacy = legacyCount - emptyCount;
		assert.ok(
			savingsVsLegacy >= 150,
			`expected large placeholder savings, got ${savingsVsLegacy} (empty=${emptyCount} one=${oneCount} legacy=${legacyCount})`,
		);
	});

	it("purges stub addon leaves and mapping allowed_values", async () => {
		const host = new FakeCleanupHost({});
		await host.setObjectNotExistsAsync("addons.sensorics.enabled", {
			type: "state",
			common: { name: "x", type: "boolean", role: "switch", read: true, write: true },
			native: {},
		} as ioBroker.Object);
		await host.setObjectNotExistsAsync("addons.wallbox.mapping.evcc_connected.allowed_values", {
			type: "state",
			common: { name: "x", type: "string", role: "json", read: true, write: true },
			native: {},
		} as ioBroker.Object);
		const stats = await runDynamicSurfaceCleanup(host);
		assert.ok(stats.deleted >= 2);
		assert.equal(host.objects.has("addons.sensorics.enabled"), false);
		assert.equal(host.objects.has("addons.wallbox.mapping.evcc_connected.allowed_values"), false);
	});

	it("purges legacy info.backup into single backup.* tree", async () => {
		const host = new FakeCleanupHost({});
		await host.setObjectNotExistsAsync("info.backup", {
			type: "channel",
			common: { name: "legacy" },
			native: {},
		} as ioBroker.Object);
		await host.setObjectNotExistsAsync("info.backup.export_register_ready", {
			type: "state",
			common: { name: "x", type: "boolean", role: "indicator", read: true, write: false },
			native: {},
		} as ioBroker.Object);
		const stats = await runDynamicSurfaceCleanup(host);
		assert.ok(stats.deleted >= 1);
		assert.equal(host.objects.has("info.backup"), false);
		assert.equal(host.objects.has("info.backup.export_register_ready"), false);
	});

	it("purges wallbox runtime ballast and user_intent diag mirrors", async () => {
		const host = new FakeCleanupHost({});
		await host.setObjectNotExistsAsync("addons.wallbox.runtime.dispatch_intent_json", {
			type: "state",
			common: { name: "x", type: "string", role: "json", read: true, write: false },
			native: {},
		} as ioBroker.Object);
		await host.setObjectNotExistsAsync("addons.wallbox.runtime.active_vehicle_snapshot_json", {
			type: "state",
			common: { name: "x", type: "string", role: "json", read: true, write: false },
			native: {},
		} as ioBroker.Object);
		await host.setObjectNotExistsAsync("user_intent.resolved_all_json", {
			type: "state",
			common: { name: "x", type: "string", role: "json", read: true, write: false },
			native: {},
		} as ioBroker.Object);
		await host.setObjectNotExistsAsync("user_intent.wallbox.sources", {
			type: "channel",
			common: { name: "sources" },
			native: {},
		} as ioBroker.Object);
		const stats = await runDynamicSurfaceCleanup(host);
		assert.ok(stats.deleted >= 3);
		assert.equal(host.objects.has("addons.wallbox.runtime.dispatch_intent_json"), false);
		assert.equal(host.objects.has("addons.wallbox.runtime.active_vehicle_snapshot_json"), false);
		assert.equal(host.objects.has("user_intent.resolved_all_json"), false);
		assert.equal(host.objects.has("user_intent.wallbox.sources"), false);
	});

	it("purges lean planner shadow roots but keeps daily/forecast/allocation", async () => {
		const host = new FakeCleanupHost({});
		for (const root of ["planner.authority", "planner.takeover", "planner.coordinator"]) {
			await host.setObjectNotExistsAsync(root, {
				type: "channel",
				common: { name: root },
				native: {},
			} as ioBroker.Object);
			await host.setObjectNotExistsAsync(`${root}.leaf`, {
				type: "state",
				common: { name: "leaf", type: "string", role: "text", read: true, write: false },
				native: {},
			} as ioBroker.Object);
		}
		for (const root of [
			"planner.intent.forecast_plan",
			"planner.intent.daily_plan",
			"planner.intent.allocation",
		]) {
			await host.setObjectNotExistsAsync(root, {
				type: "channel",
				common: { name: root },
				native: {},
			} as ioBroker.Object);
			await host.setObjectNotExistsAsync(`${root}.status`, {
				type: "state",
				common: { name: "status", type: "string", role: "text", read: true, write: false },
				native: {},
			} as ioBroker.Object);
		}
		await host.setObjectNotExistsAsync("planner.intent.supply.grid.price_now", {
			type: "state",
			common: { name: "price", type: "number", role: "value", read: true, write: false },
			native: {},
		} as ioBroker.Object);

		const stats = await runDynamicSurfaceCleanup(host);
		assert.ok(stats.deleted >= 3);
		assert.equal(host.objects.has("planner.authority"), false);
		assert.equal(host.objects.has("planner.takeover.leaf"), false);
		assert.equal(host.objects.has("planner.coordinator"), false);
		assert.equal(host.objects.has("planner.intent.forecast_plan.status"), true);
		assert.equal(host.objects.has("planner.intent.daily_plan.status"), true);
		assert.equal(host.objects.has("planner.intent.allocation.status"), true);
		assert.equal(host.objects.has("planner.intent.supply.grid.price_now"), true);
	});
});
