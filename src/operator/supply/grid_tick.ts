import { setOptionalNumberIfChanged, setStateIfChanged, type StateWriteOptions } from "../../policy/core/state_write";
import { buildGridSupplyForecast, gridSupplyRevisionPayload, type GridSupplyBuildInput } from "./grid";
import { collectGridSupplyBuildInput, type GridSupplyReadHost } from "./grid_read";
import { GRID_SUPPLY_STATE_IDS } from "./grid_states";
import type { GridSupplyForecast } from "../types";

let lastRevisionPayload = "";
let revision = 0;

export function resetGridSupplyRevisionForTest(): void {
	lastRevisionPayload = "";
	revision = 0;
}

export async function runGridSupplyTick(
	host: GridSupplyReadHost,
	prebuilt?: { forecast: GridSupplyForecast; input: GridSupplyBuildInput },
): Promise<GridSupplyForecast> {
	const input = prebuilt?.input ?? (await collectGridSupplyBuildInput(host, new Date()));
	const forecast = prebuilt?.forecast ?? buildGridSupplyForecast(input);

	const payload = gridSupplyRevisionPayload(forecast);
	const revisionChanged = payload !== lastRevisionPayload;
	const nextRevision = revisionChanged ? revision + 1 : revision;
	const writeOpts: StateWriteOptions | undefined = revisionChanged ? { skipRead: true } : undefined;

	try {
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.status, forecast.quality.status, writeOpts);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.source, forecast.source, writeOpts);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.generatedAt, forecast.generatedAt, writeOpts);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.validUntil, forecast.validUntil ?? "", writeOpts);
		await setOptionalNumberIfChanged(
			host,
			GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh,
			forecast.currentPriceCtPerKwh,
			writeOpts,
		);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.importAllowed, forecast.gridImportAllowed, writeOpts);
		await setOptionalNumberIfChanged(
			host,
			GRID_SUPPLY_STATE_IDS.maxImportPowerW,
			forecast.effectiveMaxGridImportW,
			writeOpts,
		);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.slotsJson, JSON.stringify(forecast.slots), writeOpts);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.reasonDe, forecast.reasonDe, writeOpts);
		await setStateIfChanged(host, GRID_SUPPLY_STATE_IDS.revision, nextRevision, writeOpts);
		if (revisionChanged) {
			revision = nextRevision;
			lastRevisionPayload = payload;
		}
	} catch (e) {
		host.log?.warn?.(`grid supply state write: ${String(e)}`);
	}

	return forecast;
}

export function gridSupplyRevisionForTest(): number {
	return revision;
}
