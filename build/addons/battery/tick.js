"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBatteryGridBalanceTick = exports.BATTERY_LIVE_WRITES_ENABLED = void 0;
const ems_mirror_1 = require("./ems_mirror");
const grid_balance_1 = require("./grid_balance");
const dryrun_mirror_1 = require("./dryrun_mirror");
const mapping_config_1 = require("./mapping_config");
exports.BATTERY_LIVE_WRITES_ENABLED = false;
const ADDON_ID = "battery";
async function readBool(adapter, relativeId) {
    const st = await adapter.getStateAsync(relativeId);
    return st?.val === true;
}
async function readNumber(adapter, relativeId) {
    const st = await adapter.getStateAsync(relativeId);
    if (st?.val == null)
        return null;
    const n = Number(st.val);
    return Number.isFinite(n) ? n : null;
}
async function readForeignNumber(adapter, stateId) {
    const id = stateId?.trim();
    if (!id)
        return null;
    try {
        const st = await adapter.getForeignStateAsync(id);
        if (st?.val == null)
            return null;
        const n = Number(st.val);
        return Number.isFinite(n) ? n : null;
    }
    catch {
        return null;
    }
}
async function readMappedRole(adapter, role) {
    const base = `mapping.${ADDON_ID}.${role}`;
    const en = await adapter.getStateAsync(`${base}.enabled`);
    if (en?.val === false)
        return null;
    const ts = await adapter.getStateAsync(`${base}.target_state`);
    const targetId = typeof ts?.val === "string" ? ts.val.trim() : "";
    return readForeignNumber(adapter, targetId);
}
async function mappedWriteTargetId(adapter) {
    const ts = await adapter.getStateAsync(`mapping.${ADDON_ID}.battery_charging_w.target_state`);
    return typeof ts?.val === "string" ? ts.val.trim() : "";
}
async function runBatteryGridBalanceTick(adapter) {
    const cfg = adapter.config && typeof adapter.config === "object"
        ? adapter.config
        : {};
    const profile = (0, mapping_config_1.batteryProfileFromConfig)(cfg);
    if (profile !== "sonnen") {
        adapter.log.debug(`battery tick: profile=${profile} — no handler yet`);
        return;
    }
    const addonEn = await readBool(adapter, `addons.${ADDON_ID}.enabled`);
    const gridBalanceEnabled = await readBool(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.gridBalanceEnabled);
    const batteryIntentActive = await readBool(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.batteryIntentActive);
    const snowCover = await readBool(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.snowCoverSuspected);
    const effectiveRestKwh = (await readNumber(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.effectivePvRestOfDayKwh)) ?? 0;
    const controller = (0, grid_balance_1.resolveController)({
        emsBatteryIntentActive: batteryIntentActive,
        gridBalanceEnabled,
        batteryAddonEnabled: addonEn,
    });
    const month = new Date().getMonth() + 1;
    const activeMonths = (0, mapping_config_1.activeMonthsFromConfig)(cfg);
    let capacityWh = (0, mapping_config_1.capacityWhFromConfig)(cfg);
    if (capacityWh == null) {
        capacityWh = (await readMappedRole(adapter, "capacity_wh")) ?? 0;
    }
    const consumptionW = (await readMappedRole(adapter, "consumption_w")) ?? 0;
    const pvAcPowerW = (await readMappedRole(adapter, "pv_ac_power_w")) ?? 0;
    const socPct = await readMappedRole(adapter, "soc_pct");
    const result = (0, grid_balance_1.computeGridBalanceTarget)({
        month,
        activeMonths,
        effectiveRestOfDayKwh: effectiveRestKwh,
        capacityWh,
        snowCoverSuspected: snowCover,
        consumptionW,
        pvAcPowerW,
        socPct,
        gridBalanceEnabled,
        controller,
    });
    const writeTargetId = await mappedWriteTargetId(adapter);
    const ts = new Date().toISOString();
    await adapter.setStateAsync("status.battery.controller", { val: controller, ack: true });
    await adapter.setStateAsync("status.battery.grid_balance_enabled", {
        val: gridBalanceEnabled,
        ack: true,
    });
    await adapter.setStateAsync("status.battery.updated_at", { val: ts, ack: true });
    await (0, dryrun_mirror_1.writeBatteryGridBalanceDryrun)(adapter, {
        controller,
        result,
        consumptionW,
        pvAcPowerW,
        socPct,
        effectiveRestKwh,
        targetStateId: writeTargetId,
    });
    if (result.gatePassed && writeTargetId && exports.BATTERY_LIVE_WRITES_ENABLED) {
        await adapter.setForeignStateAsync(writeTargetId, {
            val: result.targetBatteryChargingW,
            ack: true,
        });
        adapter.log.info(`battery grid_balance LIVE → ${writeTargetId} = ${result.targetBatteryChargingW} W`);
    }
    else if (result.gatePassed && writeTargetId) {
        adapter.log.debug(`battery grid_balance dryrun: would write ${result.targetBatteryChargingW} W → ${writeTargetId}`);
    }
}
exports.runBatteryGridBalanceTick = runBatteryGridBalanceTick;
