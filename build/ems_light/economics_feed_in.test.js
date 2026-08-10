"use strict";
/**
 * v0.1.262 — Admin native feed_in_ct_per_kwh → economics.config.feed_in_ct_per_kwh Spiegel.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const economics_feed_in_1 = require("./economics_feed_in");
const from_forecast_context_1 = require("../operator/daily_plan/unified/from_forecast_context");
function makeHost(opts) {
    const states = new Map();
    if (opts.stateFeedIn !== undefined)
        states.set(economics_feed_in_1.FEED_IN_CT_PER_KWH_STATE, opts.stateFeedIn);
    if (opts.migrated === true)
        states.set(economics_feed_in_1.FEED_IN_MIGRATED_V1_STATE, true);
    const config = { ...(opts.config ?? {}) };
    const updateCalls = [];
    const host = {
        config,
        updateCalls,
        async setObjectNotExistsAsync() {
            return;
        },
        async getStateAsync(id) {
            if (!states.has(id))
                return null;
            return { val: states.get(id), ack: true };
        },
        async setStateAsync(id, state) {
            states.set(id, state.val);
        },
    };
    if (opts.withUpdateConfig !== false) {
        host.updateConfig = async (next) => {
            updateCalls.push({ ...next });
            Object.assign(config, next);
        };
    }
    else {
        host.updateConfig = undefined;
    }
    return host;
}
(0, node_test_1.describe)("economics feed_in normalize", () => {
    (0, node_test_1.it)("accepts 9.3 ct/kWh; rejects negative/NaN; same rules as planner normalize", () => {
        strict_1.default.equal((0, economics_feed_in_1.normalizeFeedInCtPerKwhConfig)(9.3), 9.3);
        strict_1.default.equal((0, economics_feed_in_1.normalizeFeedInCtPerKwhConfig)(0), 0);
        strict_1.default.equal((0, economics_feed_in_1.normalizeFeedInCtPerKwhConfig)(-1), null);
        strict_1.default.equal((0, economics_feed_in_1.normalizeFeedInCtPerKwhConfig)(Number.NaN), null);
        strict_1.default.equal((0, economics_feed_in_1.normalizeFeedInCtPerKwhConfig)("9.3"), null);
        /** 0.093 bleibt 0.093 ct — kein stiller ×100. */
        strict_1.default.equal((0, economics_feed_in_1.normalizeFeedInCtPerKwhConfig)(0.093), 0.093);
        strict_1.default.equal((0, from_forecast_context_1.normalizeFeedInCtPerKwh)(9.3), (0, economics_feed_in_1.normalizeFeedInCtPerKwhConfig)(9.3));
        strict_1.default.equal((0, from_forecast_context_1.normalizeFeedInCtPerKwh)(null), null);
    });
});
(0, node_test_1.describe)("economics feed_in admin sync", () => {
    (0, node_test_1.it)("1) Admin 9.3 is mirrored to economics.config.feed_in_ct_per_kwh", async () => {
        const host = makeHost({ config: { [economics_feed_in_1.FEED_IN_CT_PER_KWH_NATIVE_KEY]: 9.3 } });
        const r = await (0, economics_feed_in_1.migrateAndSyncEconomicsFeedInFromConfig)(host);
        strict_1.default.equal(r.canonicalCtPerKwh, 9.3);
        strict_1.default.equal((await host.getStateAsync(economics_feed_in_1.FEED_IN_CT_PER_KWH_STATE))?.val, 9.3);
        strict_1.default.equal((await host.getStateAsync(economics_feed_in_1.FEED_IN_MIGRATED_V1_STATE))?.val, true);
        strict_1.default.equal((0, economics_feed_in_1.readNativeFeedInCtPerKwh)(host.config), 9.3);
    });
    (0, node_test_1.it)("2) mirrored value is planner-ready ct/kWh (9.3 not 0.093)", async () => {
        const host = makeHost({ config: { [economics_feed_in_1.FEED_IN_CT_PER_KWH_NATIVE_KEY]: 9.3 } });
        await (0, economics_feed_in_1.migrateAndSyncEconomicsFeedInFromConfig)(host);
        const mirrored = (await host.getStateAsync(economics_feed_in_1.FEED_IN_CT_PER_KWH_STATE))?.val;
        strict_1.default.equal((0, from_forecast_context_1.normalizeFeedInCtPerKwh)(mirrored), 9.3);
    });
    (0, node_test_1.it)("3) missing native → state null (planner fallback / EXPORT_TARIFF_UNKNOWN)", async () => {
        const host = makeHost({ config: {}, stateFeedIn: null });
        const r = await (0, economics_feed_in_1.migrateAndSyncEconomicsFeedInFromConfig)(host);
        strict_1.default.equal(r.canonicalCtPerKwh, null);
        strict_1.default.equal((await host.getStateAsync(economics_feed_in_1.FEED_IN_CT_PER_KWH_STATE))?.val, null);
        strict_1.default.equal((0, from_forecast_context_1.normalizeFeedInCtPerKwh)(null), null);
    });
    (0, node_test_1.it)("4) invalid native does not write NaN into state", async () => {
        const host = makeHost({ config: { [economics_feed_in_1.FEED_IN_CT_PER_KWH_NATIVE_KEY]: Number.NaN } });
        const r = await (0, economics_feed_in_1.migrateAndSyncEconomicsFeedInFromConfig)(host);
        strict_1.default.equal(r.canonicalCtPerKwh, null);
        const v = (await host.getStateAsync(economics_feed_in_1.FEED_IN_CT_PER_KWH_STATE))?.val;
        strict_1.default.equal(v === null || v === undefined, true);
        strict_1.default.equal(Number.isNaN(v), false);
    });
    (0, node_test_1.it)("5) existing valid state is migrated into native once", async () => {
        const host = makeHost({ config: {}, stateFeedIn: 9.3, withUpdateConfig: true });
        const r = await (0, economics_feed_in_1.migrateAndSyncEconomicsFeedInFromConfig)(host);
        strict_1.default.equal(r.migratedFromState, true);
        strict_1.default.equal(host.config[economics_feed_in_1.FEED_IN_CT_PER_KWH_NATIVE_KEY], 9.3);
        strict_1.default.equal(host.updateCalls.length, 1);
        strict_1.default.equal((await host.getStateAsync(economics_feed_in_1.FEED_IN_CT_PER_KWH_STATE))?.val, 9.3);
        const r2 = await (0, economics_feed_in_1.migrateAndSyncEconomicsFeedInFromConfig)(host);
        strict_1.default.equal(r2.migratedFromState, false);
        strict_1.default.equal(host.updateCalls.length, 1);
    });
    (0, node_test_1.it)("5b) without updateConfig, legacy state is not wiped before migration", async () => {
        const host = makeHost({ config: {}, stateFeedIn: 8.2, withUpdateConfig: false });
        await (0, economics_feed_in_1.migrateAndSyncEconomicsFeedInFromConfig)(host);
        strict_1.default.equal((await host.getStateAsync(economics_feed_in_1.FEED_IN_CT_PER_KWH_STATE))?.val, 8.2);
        strict_1.default.notEqual((await host.getStateAsync(economics_feed_in_1.FEED_IN_MIGRATED_V1_STATE))?.val, true);
    });
});
