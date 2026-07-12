export interface MemoryInventoryEntry {
	module: string;
	checkpoint?: string;
	recordsLoaded?: number;
	historyResults?: number;
	daysOrSlots?: number;
	mapEntries?: number;
	arrayEntries?: number;
	rawHistoryRetained?: boolean;
}

let inventoryContext = "unknown";
const latestByModule = new Map<string, MemoryInventoryEntry>();

export function setMemoryInventoryContext(module: string): void {
	inventoryContext = module.trim() || "unknown";
}

export function getMemoryInventoryContext(): string {
	return inventoryContext;
}

export function recordMemoryInventory(entry: MemoryInventoryEntry): void {
	const key = entry.module.trim() || inventoryContext;
	latestByModule.set(key, {
		...entry,
		module: key,
	});
}

export function recordHistoryFetchInventory(
	module: string,
	rowCount: number,
	options: {
		daysOrSlots?: number;
		queryKind?: string;
	} = {},
): void {
	recordMemoryInventory({
		module,
		checkpoint: options.queryKind ?? "history_fetch",
		historyResults: rowCount,
		daysOrSlots: options.daysOrSlots,
		arrayEntries: rowCount,
		rawHistoryRetained: false,
	});
}

export function formatMemoryInventoryLine(entry: MemoryInventoryEntry): string {
	const parts = [
		`EMS mem-inventory[${entry.module}]`,
		entry.checkpoint ? `cp=${entry.checkpoint}` : null,
		entry.recordsLoaded !== undefined ? `records=${entry.recordsLoaded}` : null,
		entry.historyResults !== undefined ? `historyRows=${entry.historyResults}` : null,
		entry.daysOrSlots !== undefined ? `daysOrSlots=${entry.daysOrSlots}` : null,
		entry.mapEntries !== undefined ? `mapEntries=${entry.mapEntries}` : null,
		entry.arrayEntries !== undefined ? `arrayEntries=${entry.arrayEntries}` : null,
		entry.rawHistoryRetained !== undefined ? `rawHistoryRetained=${entry.rawHistoryRetained ? "yes" : "no"}` : null,
	].filter(Boolean);
	return parts.join(" ");
}

export type MemoryInventoryLogger = {
	info?: (msg: string) => void;
	debug?: (msg: string) => void;
};

export function logMemoryInventory(
	log: MemoryInventoryLogger | undefined,
	module: string,
	checkpoint?: string,
): MemoryInventoryEntry | null {
	const entry = latestByModule.get(module);
	if (!entry) {
		return null;
	}
	const line = formatMemoryInventoryLine({ ...entry, checkpoint: checkpoint ?? entry.checkpoint });
	log?.info?.(line);
	return entry;
}

export function getMemoryInventorySnapshot(): ReadonlyMap<string, MemoryInventoryEntry> {
	return new Map(latestByModule);
}

export function resetMemoryInventoryForTest(): void {
	inventoryContext = "unknown";
	latestByModule.clear();
}
