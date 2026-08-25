import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	readNativeTariffGridFeeMonthlyEur,
	readNativeTariffMonthlyBaseEur,
	syncEconomicsTariffFeesFromConfig,
	ECONOMICS_GRID_FEE_MONTHLY_EUR_STATE,
	ECONOMICS_MONTHLY_BASE_FEE_EUR_STATE,
} from "./economics_tariff_fees.js";

describe("economics tariff fees (Tibber monatlich)", () => {
	it("reads native monthly Grundpreis + Netzentgelt", () => {
		assert.equal(readNativeTariffMonthlyBaseEur({ tariff_monthly_base_eur: 15.5 }), 15.5);
		assert.equal(readNativeTariffGridFeeMonthlyEur({ tariff_grid_fee_monthly_eur: 8.2 }), 8.2);
		assert.equal(readNativeTariffMonthlyBaseEur({}), null);
		assert.equal(readNativeTariffGridFeeMonthlyEur({ tariff_grid_fee_monthly_eur: -1 }), null);
	});

	it("mirrors to economics.config states", async () => {
		const states = new Map<string, unknown>();
		const host = {
			config: { tariff_monthly_base_eur: 12, tariff_grid_fee_monthly_eur: 5 },
			setObjectNotExistsAsync: async () => undefined,
			getStateAsync: async (id: string) =>
				states.has(id) ? ({ val: states.get(id), ack: true } as ioBroker.State) : null,
			setStateAsync: async (id: string, state: ioBroker.SettableState) => {
				states.set(id, typeof state === "object" && state && "val" in state ? state.val : state);
			},
		};
		const r = await syncEconomicsTariffFeesFromConfig(host);
		assert.equal(r.monthlyBaseEur, 12);
		assert.equal(r.gridFeeMonthlyEur, 5);
		assert.equal(states.get(ECONOMICS_MONTHLY_BASE_FEE_EUR_STATE), 12);
		assert.equal(states.get(ECONOMICS_GRID_FEE_MONTHLY_EUR_STATE), 5);
	});
});
