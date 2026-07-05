import type { BatteryMappingTable } from "../mapping";

const DEBOUNCE_MS = 500;

type TickHost = ioBroker.Adapter & { config: unknown };

let debounceTimer: NodeJS.Timeout | null = null;
const watchedStateIds = new Set<string>();

export async function setupGridBalanceWatch(
	adapter: ioBroker.Adapter,
	table: BatteryMappingTable,
): Promise<void> {
	watchedStateIds.clear();
	for (const role of ["consumption_w", "pv_ac_power_w"] as const) {
		const slot = table[role];
		if (!slot.enabled || !slot.targetState.trim()) continue;
		watchedStateIds.add(slot.targetState.trim());
		try {
			await adapter.subscribeForeignStatesAsync(slot.targetState.trim());
			adapter.log.info(`battery: Netzausgleich watch → ${role} (${slot.targetState})`);
		} catch (e) {
			adapter.log.warn(`battery: subscribe ${role} failed: ${e}`);
		}
	}
}

export function isGridBalanceWatchState(stateId: string): boolean {
	return watchedStateIds.has(stateId);
}

/** Debounced tick — wie früher runGridBalanceOnConsumptionChange (on change). */
export function scheduleGridBalanceTick(host: TickHost, runTick: (h: TickHost) => Promise<void>): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		void runTick(host).catch((e) => host.log.error(`battery grid_balance tick: ${e}`));
	}, DEBOUNCE_MS);
}

export function clearGridBalanceWatch(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	watchedStateIds.clear();
}
