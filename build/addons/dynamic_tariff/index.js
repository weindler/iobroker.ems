"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDynamicTariffModule = exports.DYNAMIC_TARIFF_ADDON_ID = void 0;
const mapping_sync_1 = require("../../mapping_sync");
const mapping_config_1 = require("./mapping_config");
exports.DYNAMIC_TARIFF_ADDON_ID = "dynamic_tariff";
async function initDynamicTariffModule(adapter) {
    await (0, mapping_sync_1.ensureAddonMappingStates)(adapter, exports.DYNAMIC_TARIFF_ADDON_ID, mapping_config_1.DYNAMIC_TARIFF_MAPPING_ROLES);
    await (0, mapping_sync_1.syncNativeMappingToStates)(adapter, exports.DYNAMIC_TARIFF_ADDON_ID, mapping_config_1.dynamicTariffMappingFromConfig);
    adapter.log.info("dynamic_tariff: read-only price mapping");
    return null;
}
exports.initDynamicTariffModule = initDynamicTariffModule;
