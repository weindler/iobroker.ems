"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const season_control_js_1 = require("./season_control.js");
function host(source, previous) {
    const states = new Map();
    if (source !== undefined)
        states.set("0_userdata.0.Heizung.Winterbetrieb", { val: source, ack: true });
    if (previous !== undefined)
        states.set(season_control_js_1.WINTER_RUNTIME_STATE, { val: previous, ack: true });
    return {
        states,
        config: { winter_operation_state: "0_userdata.0.Heizung.Winterbetrieb" },
        log: { info: () => undefined, warn: () => undefined },
        getStateAsync: async (id) => states.get(id) ?? null,
        setStateAsync: async (id, state) => { states.set(id, { val: state.val, ack: state.ack }); },
        setObjectNotExistsAsync: async () => undefined,
        subscribeForeignStatesAsync: async () => undefined,
    };
}
(0, node_test_1.describe)("saisonale Laufzeitsteuerung", () => {
    (0, node_test_1.it)("pausiert Klima und Heizstab bei Winter=true", async () => {
        const h = host(true);
        await (0, season_control_js_1.initSeasonControl)(h);
        node_assert_1.strict.equal((0, season_control_js_1.isSeasonallyPausedAddon)("air_conditioning"), true);
        node_assert_1.strict.equal((0, season_control_js_1.isSeasonallyPausedAddon)("immersion_heater"), true);
        node_assert_1.strict.equal((0, season_control_js_1.isSeasonallyPausedAddon)("battery"), false);
    });
    (0, node_test_1.it)("behält bei Quellenausfall den letzten bestätigten Stand", async () => {
        const h = host(undefined, false);
        await (0, season_control_js_1.initSeasonControl)(h);
        node_assert_1.strict.equal((0, season_control_js_1.isSeasonallyPausedAddon)("air_conditioning"), false);
        await (0, season_control_js_1.handleSeasonStateChange)(h, "0_userdata.0.Heizung.Winterbetrieb", { val: true, ack: true });
        node_assert_1.strict.equal((0, season_control_js_1.isSeasonallyPausedAddon)("air_conditioning"), true);
        await (0, season_control_js_1.handleSeasonStateChange)(h, "0_userdata.0.Heizung.Winterbetrieb", { val: null, ack: true });
        node_assert_1.strict.equal((0, season_control_js_1.isSeasonallyPausedAddon)("air_conditioning"), true);
        await (0, season_control_js_1.handleSeasonStateChange)(h, "0_userdata.0.Heizung.Winterbetrieb", { val: false, ack: true });
    });
});
