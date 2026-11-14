import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resetEnergyforecastRunState, runEnergyforecast, type EnergyforecastHost } from "../../learning/energyforecast/run";
import { readDynamicTariffPrice15MinSlots, type GridSupplyReadHost } from "./grid_read";

const TOKEN = "T-OKEN";

function rows(date: string, origin: string, total: number): unknown[] {
	const start = new Date(`${date}T00:00:00`).getTime();
	return Array.from({ length: 96 }, (_, i) => ({
		start: new Date(start + i * 900_000).toISOString(),
		end: new Date(start + (i + 1) * 900_000).toISOString(),
		price_ct_kwh: total - 20,
		total_ct_kwh: total,
		price_origin: origin,
	}));
}

describe("Preisquelle: Tibber Vorrang, Energyforecast füllt auf", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "efgrid-"));
		resetEnergyforecastRunState();
	});
	afterEach(async () => {
		resetEnergyforecastRunState();
		await fs.rm(dir, { recursive: true, force: true });
	});

	async function setup(efEnabled: boolean, tibberJson: string | null) {
		const config = {
			energyforecast_enabled: efEnabled,
			energyforecast_token: TOKEN,
			learning_price_forecast_today_json_state: tibberJson === null ? "" : "tibberlink.0.PricesToday.json",
		};
		const efHost = {
			config,
			getAbsolutePath: () => dir,
			setStateAsync: async () => undefined,
			getStateAsync: async () => null,
			setObjectNotExistsAsync: async () => undefined,
			log: { info: () => undefined, warn: () => undefined },
		} as unknown as EnergyforecastHost;
		const body = { plan: "free", data: [...rows("2026-11-14", "market", 40), ...rows("2026-11-15", "forecast", 36)] };
		await runEnergyforecast(efHost, new Date("2026-11-14T09:20:00").getTime(), async () => new Response(JSON.stringify(body)));
		const gridHost = {
			config,
			getStateAsync: async () => null,
			getForeignStateAsync: async (id: string) => (id === "tibberlink.0.PricesToday.json" ? { val: tibberJson } : null),
		} as unknown as GridSupplyReadHost;
		return gridHost;
	}

	it("Tibber-Slots gewinnen, Energyforecast ergänzt nur Spätere und markiert Prognose", async () => {
		const tibber = JSON.stringify(
			Array.from({ length: 96 }, (_, i) => ({
				total: 0.5,
				startsAt: new Date(new Date("2026-11-14T00:00:00").getTime() + i * 900_000).toISOString(),
			})),
		);
		const host = await setup(true, tibber);
		const slots = await readDynamicTariffPrice15MinSlots(host, new Date("2026-11-14T09:20:00"));
		const today = slots.filter((s) => new Date(s.slotStartMs).getDate() === 14);
		const tomorrow = slots.filter((s) => new Date(s.slotStartMs).getDate() === 15);
		assert.ok(today.length > 0 && today.every((s) => s.priceCtPerKwh === 50 && s.origin === undefined), "heute Tibber (50 ct)");
		assert.equal(tomorrow.length, 96);
		assert.ok(tomorrow.every((s) => s.priceCtPerKwh === 36 && s.origin === "forecast"));
	});

	it("ohne Tibber-Konfiguration liefert Energyforecast die Preise", async () => {
		const host = await setup(true, null);
		const slots = await readDynamicTariffPrice15MinSlots(host, new Date("2026-11-14T09:20:00"));
		assert.ok(slots.length > 96);
		assert.ok(slots.some((s) => s.priceCtPerKwh === 40 && s.origin === undefined), "Markt-Slots ohne Prognosemarke");
	});

	it("Energyforecast aus: unverändertes Verhalten (leer ohne Tibber)", async () => {
		const host = await setup(false, null);
		assert.deepEqual(await readDynamicTariffPrice15MinSlots(host, new Date("2026-11-14T09:20:00")), []);
	});
});
