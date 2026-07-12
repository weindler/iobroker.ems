"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncAllMappingsFromConfig = exports.ensureDynamicVehicleProfiles = exports.ensureStaticStateTree = void 0;
const air_conditioning_1 = require("../addons/air_conditioning");
const battery_1 = require("../addons/battery");
const immersion_heater_1 = require("../addons/immersion_heater");
const wallbox_1 = require("../addons/wallbox");
const governance_1 = require("../addons/governance");
const mapping_sync_1 = require("../mapping_sync");
const mapping_config_1 = require("../mapping_config");
const ems_light_1 = require("../ems_light");
const execution_mode_1 = require("../execution_mode");
const status_wallbox_1 = require("../status_wallbox");
const dynamic_tariff_1 = require("../addons/dynamic_tariff");
const mapping_config_2 = require("../addons/dynamic_tariff/mapping_config");
const battery_2 = require("../addons/battery");
const mapping_1 = require("../addons/battery/mapping");
const immersion_heater_2 = require("../addons/immersion_heater");
const mapping_config_3 = require("../addons/immersion_heater/mapping_config");
const constants_1 = require("../addons/air_conditioning/constants");
const mapping_config_4 = require("../addons/air_conditioning/mapping_config");
const base_ensure_1 = require("./base_ensure");
/** Phase B — statischer EMS-State-Tree ohne dynamische Fahrzeugprofile. */
async function ensureStaticStateTree(host) {
    await (0, execution_mode_1.ensureChannelTree)(host.setObjectNotExistsAsync.bind(host));
    await (0, base_ensure_1.ensureCommandBaseStates)(host);
    await (0, execution_mode_1.ensureGlobalExecutionStates)(host);
    await (0, execution_mode_1.ensureAddonExecutionModeStates)(host);
    await (0, base_ensure_1.ensureAddonBasisStates)(host);
    await (0, governance_1.ensureAddonGovernanceStates)(host);
    await (0, ems_light_1.ensureEmsLightStateTree)(host);
    await (0, mapping_sync_1.ensureAddonMappingStates)(host, "wallbox", mapping_config_1.WALLBOX_ALL_MAPPING_IDS);
    await (0, status_wallbox_1.ensureWallboxStatusStates)(host);
    await (0, wallbox_1.ensureWallboxStaticStateTree)(host);
    await (0, battery_1.ensureBatteryStateTree)(host);
    await (0, immersion_heater_1.ensureImmersionHeaterStateTree)(host);
    await (0, air_conditioning_1.ensureAirConditioningStateTree)(host);
    await (0, mapping_sync_1.ensureAddonMappingStates)(host, dynamic_tariff_1.DYNAMIC_TARIFF_ADDON_ID, mapping_config_2.DYNAMIC_TARIFF_MAPPING_ROLES);
}
exports.ensureStaticStateTree = ensureStaticStateTree;
/** Phase C — dynamische Fahrzeugprofil-Ordner aus `wb_vehicle_profiles`. */
async function ensureDynamicVehicleProfiles(host) {
    await (0, wallbox_1.ensureWallboxDynamicVehicleProfiles)(host);
}
exports.ensureDynamicVehicleProfiles = ensureDynamicVehicleProfiles;
/** Phase sync — Mapping-Werte aus Admin-Config (nach Objekterzeugung). */
async function syncAllMappingsFromConfig(host) {
    await (0, mapping_sync_1.syncNativeMappingToStates)(host, "wallbox", mapping_config_1.wallboxMappingFromConfig);
    await (0, mapping_sync_1.syncNativeMappingToStates)(host, battery_2.BATTERY_ADDON_ID, mapping_1.batteryMappingNativeFromConfig);
    await (0, mapping_sync_1.syncNativeMappingToStates)(host, immersion_heater_2.IMMERSION_ADDON_ID, mapping_config_3.immersionHeaterMappingFromConfig);
    await (0, mapping_sync_1.syncNativeMappingToStates)(host, constants_1.AC_ADDON_ID, mapping_config_4.acMappingFromConfig);
    await (0, mapping_sync_1.syncNativeMappingToStates)(host, dynamic_tariff_1.DYNAMIC_TARIFF_ADDON_ID, mapping_config_2.dynamicTariffMappingFromConfig);
}
exports.syncAllMappingsFromConfig = syncAllMappingsFromConfig;
