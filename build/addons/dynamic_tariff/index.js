"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DYNAMIC_TARIFF_ADDON_ID = void 0;
exports.initDynamicTariffModule = initDynamicTariffModule;
exports.DYNAMIC_TARIFF_ADDON_ID = "dynamic_tariff";
async function initDynamicTariffModule(adapter) {
    adapter.log.debug("dynamic_tariff: price mapping from adapter config");
    return null;
}
