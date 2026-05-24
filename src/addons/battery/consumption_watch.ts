import { mappedTargetId } from "./io";
import { runGridBalanceOnConsumptionChange, type BatteryTickHost } from "./grid_balance_runner";

const DEBOUNCE_MS = 800;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let watchedConsumptionId: string | null = null;

export async function setupConsumptionWatch(adapter: BatteryTickHost): Promise<void> {
	const { targetId } = await mappedTargetId(adapter, "consumption_w");
	watchedConsumptionId = targetId || null;
	if (watchedConsumptionId) {
		try {
			await adapter.subscribeForeignStatesAsync(watchedConsumptionId);
			adapter.log.info(`battery: subscribe consumption_w → ${watchedConsumptionId}`);
		} catch (e) {
			adapter.log.warn(`battery: subscribe consumption failed: ${e}`);
		}
	}
}

export function isWatchedConsumptionState(stateId: string): boolean {
	return !!watchedConsumptionId && stateId === watchedConsumptionId;
}

export function onConsumptionStateChange(adapter: BatteryTickHost): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		void runGridBalanceOnConsumptionChange(adapter, "consumption_change").catch((e) => {
			adapter.log.error(`battery grid_balance on consumption: ${e}`);
		});
	}, DEBOUNCE_MS);
}

export function clearConsumptionWatch(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	watchedConsumptionId = null;
}
