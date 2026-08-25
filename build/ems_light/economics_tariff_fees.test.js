"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const economics_tariff_fees_js_1 = require("./economics_tariff_fees.js");
(0, node_test_1.describe)("economics tariff fees (Tibber monatlich)", () => {
    (0, node_test_1.it)("reads native monthly Grundpreis + Netzentgelt", () => {
        strict_1.default.equal((0, economics_tariff_fees_js_1.readNativeTariffMonthlyBaseEur)({ tariff_monthly_base_eur: 15.5 }), 15.5);
        strict_1.default.equal((0, economics_tariff_fees_js_1.readNativeTariffGridFeeMonthlyEur)({ tariff_grid_fee_monthly_eur: 8.2 }), 8.2);
        strict_1.default.equal((0, economics_tariff_fees_js_1.readNativeTariffMonthlyBaseEur)({}), null);
        strict_1.default.equal((0, economics_tariff_fees_js_1.readNativeTariffGridFeeMonthlyEur)({ tariff_grid_fee_monthly_eur: -1 }), null);
    });
    (0, node_test_1.it)("mirrors to economics.config states", async () => {
        const states = new Map();
        const host = {
            config: { tariff_monthly_base_eur: 12, tariff_grid_fee_monthly_eur: 5 },
            setObjectNotExistsAsync: async () => undefined,
            getStateAsync: async (id) => states.has(id) ? { val: states.get(id), ack: true } : null,
            setStateAsync: async (id, state) => {
                states.set(id, typeof state === "object" && state && "val" in state ? state.val : state);
            },
        };
        const r = await (0, economics_tariff_fees_js_1.syncEconomicsTariffFeesFromConfig)(host);
        strict_1.default.equal(r.monthlyBaseEur, 12);
        strict_1.default.equal(r.gridFeeMonthlyEur, 5);
        strict_1.default.equal(states.get(economics_tariff_fees_js_1.ECONOMICS_MONTHLY_BASE_FEE_EUR_STATE), 12);
        strict_1.default.equal(states.get(economics_tariff_fees_js_1.ECONOMICS_GRID_FEE_MONTHLY_EUR_STATE), 5);
    });
});
