"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__resetBatteryFailsafeForTest = exports.runBatteryFailsafeCheck = void 0;
const config_1 = require("./config");
const mapping_1 = require("./mapping");
const registry_1 = require("./profiles/registry");
const execution_mode_1 = require("../../execution_mode");
const device_write_1 = require("../../device_write");
const failsafe_common_1 = require("../../failsafe_common");
const ensure_states_1 = require("./ensure_states");
const ADDON_ID = "battery";
/** Config-Präfix für `failsafeTimeoutsFromConfig` — analog "wb"/"ih". */
const CONFIG_PREFIX = "bat";
let lastEmsReachable = null;
/**
 * Erzwingt den sicheren Ruhezustand (Ladung 0 W, Self-Consumption-Modus) direkt,
 * ohne die FSM — analog `forceWallboxSafeOff` / `forceImmersionHeaterOff`. Läuft
 * unabhängig vom regulären Control-Tick, damit ein hängender Adapter-Loop die
 * Batterie nicht dauerhaft im aktiven Lade-Zustand belässt.
 */
async function forceBatterySafeState(adapter, reason) {
    const config = (0, config_1.batteryConfigFromAdapter)(adapter.config);
    const table = (0, mapping_1.batteryMappingFromConfig)(adapter.config);
    const powerTarget = table.set_charge_power.targetState;
    const modeTarget = table.set_operating_mode.targetState;
    if (!powerTarget && !modeTarget) {
        adapter.log.warn(`battery failsafe (${reason}): no set_charge_power/set_operating_mode mapping`);
        return false;
    }
    let wrote = false;
    try {
        if (powerTarget) {
            const r = await (0, device_write_1.writeForeignIfChanged)(adapter, {
                stateId: powerTarget,
                value: 0,
                reason: `battery failsafe: ${reason}`,
            });
            if (r.written)
                wrote = true;
        }
        if (modeTarget) {
            const r = await (0, device_write_1.writeForeignIfChanged)(adapter, {
                stateId: modeTarget,
                value: config.sonnenModeValues.selfConsumption,
                reason: `battery failsafe: ${reason}`,
            });
            if (r.written)
                wrote = true;
        }
        adapter.log.warn(`battery failsafe (${reason}): charge power 0, self-consumption forced`);
        return true;
    }
    catch (e) {
        adapter.log.error(`battery failsafe write failed: ${String(e)}`);
        return wrote;
    }
}
/**
 * Unabhängiger Sicherheitspfad (eigener Timer, siehe `failsafe_runner.ts`): erzwingt
 * Safe-Restore, wenn der EMS-Haupt-Tick nicht mehr läuft (Tick-Ausfall/Adapter-Hang) —
 * `batteryUnloadRestore` in `index.ts` deckt nur den sauberen Adapter-Unload ab.
 */
async function runBatteryFailsafeCheck(adapter) {
    const cfg = adapter.config && typeof adapter.config === "object" ? adapter.config : {};
    const config = (0, config_1.batteryConfigFromAdapter)(cfg);
    const profile = (0, registry_1.getBatteryProfile)(config.profile);
    if (!profile.supportsLive) {
        return;
    }
    const liveAllowed = await (0, execution_mode_1.isLiveWriteAllowed)((id) => adapter.getStateAsync(id), ADDON_ID);
    const emsReachable = !(0, failsafe_common_1.isEmsUnreachable)(cfg, CONFIG_PREFIX);
    await (0, failsafe_common_1.setEdgeBool)(adapter, ensure_states_1.BAT.failsafe.emsReachable, emsReachable);
    if (lastEmsReachable !== emsReachable) {
        lastEmsReachable = emsReachable;
        adapter.log.debug(`battery: ems_reachable=${emsReachable}`);
    }
    await (0, failsafe_common_1.setEdgeBool)(adapter, ensure_states_1.BAT.failsafe.wouldTrip, !emsReachable && !liveAllowed);
    const ts = new Date().toISOString();
    await adapter.setStateAsync(ensure_states_1.BAT.failsafe.updatedAt, { val: ts, ack: true });
    if (emsReachable) {
        const active = await adapter.getStateAsync(ensure_states_1.BAT.failsafe.active);
        if (active?.val === true && liveAllowed) {
            await adapter.setStateAsync(ensure_states_1.BAT.failsafe.active, { val: false, ack: true });
        }
        return;
    }
    if (!liveAllowed) {
        return;
    }
    const wrote = await forceBatterySafeState(adapter, "ems_unreachable");
    if (wrote) {
        await adapter.setStateAsync(ensure_states_1.BAT.failsafe.active, { val: true, ack: true });
        await adapter.setStateAsync(ensure_states_1.BAT.failsafe.lastFailsafeAt, { val: ts, ack: true });
    }
}
exports.runBatteryFailsafeCheck = runBatteryFailsafeCheck;
/** Nur für Tests: Kanten-Erkennung (Log-Debounce) zurücksetzen. */
function __resetBatteryFailsafeForTest() {
    lastEmsReachable = null;
}
exports.__resetBatteryFailsafeForTest = __resetBatteryFailsafeForTest;
