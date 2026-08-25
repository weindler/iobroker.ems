"use strict";
/**
 * Tarif-Tab (Tibber): monatliche Grundgebühr + monatliches Netzentgelt → economics.config.
 * Verivox/Statistik-Festtarif bleibt separat (dort alles im Vergleichstarif enthalten).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncEconomicsTariffFeesFromConfig = exports.readNativeTariffGridFeeMonthlyEur = exports.readNativeTariffMonthlyBaseEur = exports.ECONOMICS_GRID_FEE_MONTHLY_EUR_STATE = exports.ECONOMICS_MONTHLY_BASE_FEE_EUR_STATE = exports.TARIFF_GRID_FEE_MONTHLY_EUR_NATIVE_KEY = exports.TARIFF_MONTHLY_BASE_EUR_NATIVE_KEY = void 0;
const state_write_1 = require("../policy/core/state_write");
exports.TARIFF_MONTHLY_BASE_EUR_NATIVE_KEY = "tariff_monthly_base_eur";
exports.TARIFF_GRID_FEE_MONTHLY_EUR_NATIVE_KEY = "tariff_grid_fee_monthly_eur";
exports.ECONOMICS_MONTHLY_BASE_FEE_EUR_STATE = "economics.config.monthly_base_fee_eur";
exports.ECONOMICS_GRID_FEE_MONTHLY_EUR_STATE = "economics.config.grid_fee_monthly_eur";
function normalizeNonNeg(raw) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0)
        return null;
    return raw;
}
function readNativeTariffMonthlyBaseEur(config) {
    if (!config || typeof config !== "object")
        return null;
    return normalizeNonNeg(config[exports.TARIFF_MONTHLY_BASE_EUR_NATIVE_KEY]);
}
exports.readNativeTariffMonthlyBaseEur = readNativeTariffMonthlyBaseEur;
function readNativeTariffGridFeeMonthlyEur(config) {
    if (!config || typeof config !== "object")
        return null;
    return normalizeNonNeg(config[exports.TARIFF_GRID_FEE_MONTHLY_EUR_NATIVE_KEY]);
}
exports.readNativeTariffGridFeeMonthlyEur = readNativeTariffGridFeeMonthlyEur;
async function syncEconomicsTariffFeesFromConfig(host) {
    await host.setObjectNotExistsAsync(exports.ECONOMICS_GRID_FEE_MONTHLY_EUR_STATE, {
        type: "state",
        common: {
            name: "Economics Netzentgelt / Monat (Tibber)",
            type: "number",
            role: "value",
            unit: "EUR",
            read: true,
            write: false,
        },
        native: {},
    });
    const monthly = readNativeTariffMonthlyBaseEur(host.config);
    const gridMonthly = readNativeTariffGridFeeMonthlyEur(host.config);
    let mirrored = false;
    mirrored =
        (await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.ECONOMICS_MONTHLY_BASE_FEE_EUR_STATE, monthly)) || mirrored;
    mirrored =
        (await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.ECONOMICS_GRID_FEE_MONTHLY_EUR_STATE, gridMonthly)) ||
            mirrored;
    return { monthlyBaseEur: monthly, gridFeeMonthlyEur: gridMonthly, mirrored };
}
exports.syncEconomicsTariffFeesFromConfig = syncEconomicsTariffFeesFromConfig;
