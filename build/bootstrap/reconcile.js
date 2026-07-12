"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPostBootstrapReconciliation = void 0;
const air_conditioning_1 = require("../addons/air_conditioning");
const battery_1 = require("../addons/battery");
const immersion_heater_1 = require("../addons/immersion_heater");
const wallbox_1 = require("../addons/wallbox");
/**
 * Nach Öffnung der Bootstrap-Barriere: aktuelle Fremdeingänge erneut einlesen.
 * Schließt die Lücke zwischen Modul-Initial-Read (Phase E/F) und Barriereöffnung.
 */
async function runPostBootstrapReconciliation(host) {
    await (0, wallbox_1.refreshWallboxEvccTelemetry)(host);
    await (0, battery_1.runBatteryControlTick)(host);
    await (0, immersion_heater_1.refreshImmersionHeaterRuntime)(host);
    await (0, air_conditioning_1.refreshAirConditioningRuntime)(host);
}
exports.runPostBootstrapReconciliation = runPostBootstrapReconciliation;
