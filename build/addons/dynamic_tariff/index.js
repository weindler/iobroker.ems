"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDynamicTariffModule = exports.DYNAMIC_TARIFF_ADDON_ID = void 0;
const mapping_sync_1 = require("../../mapping_sync");
const mapping_config_1 = require("./mapping_config");
exports.DYNAMIC_TARIFF_ADDON_ID = "dynamic_tariff";
async function initDynamicTariffModule(adapter) {
    const cfg = adapter.config && typeof adapter.config === "object"
        ? adapter.config
        : {};
    await (0, mapping_sync_1.ensureAddonMappingStates)(adapter, exports.DYNAMIC_TARIFF_ADDON_ID, (0, mapping_sync_1.mappingCommandsFromEntries)((0, mapping_config_1.dynamicTariffMappingFromConfig)(cfg)));
    await (0, mapping_sync_1.syncNativeMappingToStates)(adapter, exports.DYNAMIC_TARIFF_ADDON_ID, mapping_config_1.dynamicTariffMappingFromConfig);
    adapter.log.debug("dynamic_tariff: read-only price mapping");
    return null;
}
exports.initDynamicTariffModule = initDynamicTariffModule;
