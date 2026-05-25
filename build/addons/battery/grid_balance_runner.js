"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGridBalanceOnConsumptionChange = void 0;
const execution_mode_1 = require("../../execution_mode");
const status_battery_1 = require("../../status_battery");
const ems_mirror_1 = require("./ems_mirror");
const grid_balance_1 = require("./grid_balance");
const dryrun_mirror_1 = require("./dryrun_mirror");
const mapping_config_1 = require("./mapping_config");
const io_1 = require("./io");
const mode_orchestrator_1 = require("./mode_orchestrator");
const mode_control_1 = require("./mode_control");
const ADDON_ID = "battery";
let lastController = "idle";
async function runGridBalanceOnConsumptionChange(adapter, trigger) {
    const cfg = adapter.config && typeof adapter.config === "object"
        ? adapter.config
        : {};
    if ((0, mapping_config_1.batteryProfileFromConfig)(cfg) !== "sonnen") {
        return;
    }
    if ((0, mode_orchestrator_1.isModeSequenceRunning)()) {
        return;
    }
    const addonEn = await (0, io_1.readBool)(adapter, `addons.${ADDON_ID}.enabled`);
    const adapterFeature = (0, mapping_config_1.featureGridBalanceFromConfig)(cfg);
    const emsGb = await (0, io_1.readBool)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.gridBalanceEnabled);
    const batteryIntentActive = await (0, io_1.readBool)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.batteryIntentActive);
    const snowCover = await (0, io_1.readBool)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.snowCoverSuspected);
    const effectiveRestKwh = (await (0, io_1.readNumber)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.effectivePvRestOfDayKwh)) ?? 0;
    const capacityWh = (await (0, io_1.readNumber)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.capacityWh)) ?? 0;
    const gbPaused = (0, mode_orchestrator_1.isGridBalancePaused)();
    const controller = (0, grid_balance_1.resolveController)({
        emsBatteryIntentActive: batteryIntentActive,
        emsGridBalanceEnabled: emsGb,
        adapterFeatureEnabled: adapterFeature,
        batteryAddonEnabled: addonEn,
        gridBalancePaused: gbPaused,
    });
    const offsets = (0, mapping_config_1.gridBalanceOffsetsFromConfig)(cfg);
    const consumptionW = (await (0, io_1.readMappedRole)(adapter, "consumption_w")) ?? 0;
    const pvAcPowerW = (await (0, io_1.readMappedRole)(adapter, "pv_ac_power_w")) ?? 0;
    const socPct = await (0, io_1.readMappedRole)(adapter, "soc_pct");
    const result = (0, grid_balance_1.computeGridBalanceTarget)({
        effectiveRestOfDayKwh: effectiveRestKwh,
        capacityWh,
        snowCoverSuspected: snowCover,
        consumptionW,
        pvAcPowerW,
        socPct,
        emsGridBalanceEnabled: emsGb,
        adapterFeatureEnabled: adapterFeature,
        controller,
        ...offsets,
    });
    const chargeMap = await (0, io_1.mappedTargetId)(adapter, "battery_charging_w");
    const ts = new Date().toISOString();
    await adapter.setStateAsync(status_battery_1.BATTERY_STATUS_STATES.controller, { val: controller, ack: true });
    await adapter.setStateAsync(status_battery_1.BATTERY_STATUS_STATES.gridBalanceEnabled, {
        val: emsGb && adapterFeature,
        ack: true,
    });
    await adapter.setStateAsync(status_battery_1.BATTERY_STATUS_STATES.updatedAt, { val: ts, ack: true });
    await (0, dryrun_mirror_1.writeBatteryGridBalanceDryrun)(adapter, {
        controller,
        result,
        consumptionW,
        pvAcPowerW,
        socPct,
        effectiveRestKwh,
        targetStateId: chargeMap.targetId,
        trigger,
    });
    const live = await (0, execution_mode_1.isLiveWriteAllowed)((id) => adapter.getStateAsync(id), ADDON_ID);
    if (controller === "grid_balance" && result.gatePassed && chargeMap.targetId && !gbPaused) {
        await (0, mode_control_1.ensureOperatingMode)(adapter, mode_control_1.SONNEN_OPERATING_MODE_MANUAL, live);
        const wrote = await (0, io_1.writeForeignIfLive)(adapter, chargeMap.targetId, result.targetBatteryChargingW, live);
        if (wrote) {
            adapter.log.info(`battery grid_balance LIVE (${trigger}) → ${result.targetBatteryChargingW} W`);
        }
        else {
            adapter.log.debug(`battery grid_balance dryrun (${trigger}): ${result.targetBatteryChargingW} W → ${chargeMap.targetId}`);
        }
    }
    else if (lastController === "grid_balance" && controller === "idle") {
        await (0, mode_control_1.ensureOperatingMode)(adapter, mode_control_1.SONNEN_OPERATING_MODE_AUTO, live);
    }
    lastController = controller;
}
exports.runGridBalanceOnConsumptionChange = runGridBalanceOnConsumptionChange;
