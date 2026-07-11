import { setOptionalNumberIfChanged, setStateIfChanged } from "../../policy/core/state_write";
import { buildGridSupplyForecast, gridSupplyRevisionPayload } from "./grid";
import { collectGridSupplyBuildInput, type GridSupplyReadHost } from "./grid_read";
import { GRID_SUPPLY_STATE_IDS } from "./grid_states";
import type { GridSupplyForecast } from "../types";

let lastRevisionPayload = "";
let revision = 0;

export function resetGridSupplyRevisionForTest(): void {
	lastRevisionPayload = "";
	revision = 0;
}

export async function runGridSupplyTick(host: GridSupplyReadHost): Promise<GridSupplyForecast> {
	const input = await collectGridSupplyBuildInput(host, new Date());
	const forecast = buildGridSupplyForecast(input);

	const payload = gridSupplyRevisionPayload(forecast);
	if (payload !== lastRevisionPayload) {
		revision += 1;
		lastRevisionPayload = payload;
	}

	try {
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.status, forecast.quality.status);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.source, forecast.source);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.generatedAt, forecast.generatedAt);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.validUntil, forecast.validUntil ?? "");
		await setOptionalNumberIfChanged(
			host,
			GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh,
			forecast.currentPriceCtPerKwh,
		);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.importAllowed, forecast.gridImportAllowed);
		await setOptionalNumberIfChanged(
			host,
			GRID_SUPPLY_STATE_IDS.maxImportPowerW,
			forecast.effectiveMaxGridImportW,
		);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.slotsJson, JSON.stringify(forecast.slots));
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.reasonDe, forecast.reasonDe);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.revision, revision);
	} catch (e) {
		host.log?.warn?.(`grid supply state write: ${String(e)}`);
	}

	return forecast;
}

export function gridSupplyRevisionForTest(): number {
	return revision;
}
