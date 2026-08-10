/**
 * v0.1.262 — Admin native feed_in_ct_per_kwh → economics.config.feed_in_ct_per_kwh Spiegel.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	FEED_IN_CT_PER_KWH_NATIVE_KEY,
	FEED_IN_CT_PER_KWH_STATE,
	FEED_IN_MIGRATED_V1_STATE,
	migrateAndSyncEconomicsFeedInFromConfig,
	normalizeFeedInCtPerKwhConfig,
	readNativeFeedInCtPerKwh,
	type EconomicsFeedInHost,
} from "./economics_feed_in";
import { normalizeFeedInCtPerKwh } from "../operator/daily_plan/unified/from_forecast_context";

function makeHost(opts: {
	config?: Record<string, unknown>;
	stateFeedIn?: number | null;
	migrated?: boolean;
	withUpdateConfig?: boolean;
}): EconomicsFeedInHost & { config: Record<string, unknown>; updateCalls: Record<string, unknown>[] } {
	const states = new Map<string, ioBroker.StateValue>();
	if (opts.stateFeedIn !== undefined) states.set(FEED_IN_CT_PER_KWH_STATE, opts.stateFeedIn);
	if (opts.migrated === true) states.set(FEED_IN_MIGRATED_V1_STATE, true);
	const config = { ...(opts.config ?? {}) };
	const updateCalls: Record<string, unknown>[] = [];
	const host: EconomicsFeedInHost & {
		config: Record<string, unknown>;
		updateCalls: Record<string, unknown>[];
	} = {
		config,
		updateCalls,
		async setObjectNotExistsAsync() {
			return;
		},
		async getStateAsync(id: string) {
			if (!states.has(id)) return null;
			return { val: states.get(id), ack: true } as ioBroker.State;
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			states.set(id, state.val as ioBroker.StateValue);
		},
	};
	if (opts.withUpdateConfig !== false) {
		host.updateConfig = async (next: Record<string, unknown>) => {
			updateCalls.push({ ...next });
			Object.assign(config, next);
		};
	} else {
		host.updateConfig = undefined;
	}
	return host;
}

describe("economics feed_in normalize", () => {
	it("accepts 9.3 ct/kWh; rejects negative/NaN; same rules as planner normalize", () => {
		assert.equal(normalizeFeedInCtPerKwhConfig(9.3), 9.3);
		assert.equal(normalizeFeedInCtPerKwhConfig(0), 0);
		assert.equal(normalizeFeedInCtPerKwhConfig(-1), null);
		assert.equal(normalizeFeedInCtPerKwhConfig(Number.NaN), null);
		assert.equal(normalizeFeedInCtPerKwhConfig("9.3"), null);
		/** 0.093 bleibt 0.093 ct — kein stiller ×100. */
		assert.equal(normalizeFeedInCtPerKwhConfig(0.093), 0.093);
		assert.equal(normalizeFeedInCtPerKwh(9.3), normalizeFeedInCtPerKwhConfig(9.3));
		assert.equal(normalizeFeedInCtPerKwh(null), null);
	});
});

describe("economics feed_in admin sync", () => {
	it("1) Admin 9.3 is mirrored to economics.config.feed_in_ct_per_kwh", async () => {
		const host = makeHost({ config: { [FEED_IN_CT_PER_KWH_NATIVE_KEY]: 9.3 } });
		const r = await migrateAndSyncEconomicsFeedInFromConfig(host);
		assert.equal(r.canonicalCtPerKwh, 9.3);
		assert.equal((await host.getStateAsync(FEED_IN_CT_PER_KWH_STATE))?.val, 9.3);
		assert.equal((await host.getStateAsync(FEED_IN_MIGRATED_V1_STATE))?.val, true);
		assert.equal(readNativeFeedInCtPerKwh(host.config), 9.3);
	});

	it("2) mirrored value is planner-ready ct/kWh (9.3 not 0.093)", async () => {
		const host = makeHost({ config: { [FEED_IN_CT_PER_KWH_NATIVE_KEY]: 9.3 } });
		await migrateAndSyncEconomicsFeedInFromConfig(host);
		const mirrored = (await host.getStateAsync(FEED_IN_CT_PER_KWH_STATE))?.val;
		assert.equal(normalizeFeedInCtPerKwh(mirrored), 9.3);
	});

	it("3) missing native → state null (planner fallback / EXPORT_TARIFF_UNKNOWN)", async () => {
		const host = makeHost({ config: {}, stateFeedIn: null });
		const r = await migrateAndSyncEconomicsFeedInFromConfig(host);
		assert.equal(r.canonicalCtPerKwh, null);
		assert.equal((await host.getStateAsync(FEED_IN_CT_PER_KWH_STATE))?.val, null);
		assert.equal(normalizeFeedInCtPerKwh(null), null);
	});

	it("4) invalid native does not write NaN into state", async () => {
		const host = makeHost({ config: { [FEED_IN_CT_PER_KWH_NATIVE_KEY]: Number.NaN } });
		const r = await migrateAndSyncEconomicsFeedInFromConfig(host);
		assert.equal(r.canonicalCtPerKwh, null);
		const v = (await host.getStateAsync(FEED_IN_CT_PER_KWH_STATE))?.val;
		assert.equal(v === null || v === undefined, true);
		assert.equal(Number.isNaN(v as number), false);
	});

	it("5) existing valid state is migrated into native once", async () => {
		const host = makeHost({ config: {}, stateFeedIn: 9.3, withUpdateConfig: true });
		const r = await migrateAndSyncEconomicsFeedInFromConfig(host);
		assert.equal(r.migratedFromState, true);
		assert.equal(host.config[FEED_IN_CT_PER_KWH_NATIVE_KEY], 9.3);
		assert.equal(host.updateCalls.length, 1);
		assert.equal((await host.getStateAsync(FEED_IN_CT_PER_KWH_STATE))?.val, 9.3);
		const r2 = await migrateAndSyncEconomicsFeedInFromConfig(host);
		assert.equal(r2.migratedFromState, false);
		assert.equal(host.updateCalls.length, 1);
	});

	it("5b) without updateConfig, legacy state is not wiped before migration", async () => {
		const host = makeHost({ config: {}, stateFeedIn: 8.2, withUpdateConfig: false });
		await migrateAndSyncEconomicsFeedInFromConfig(host);
		assert.equal((await host.getStateAsync(FEED_IN_CT_PER_KWH_STATE))?.val, 8.2);
		assert.notEqual((await host.getStateAsync(FEED_IN_MIGRATED_V1_STATE))?.val, true);
	});
});
