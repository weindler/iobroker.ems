"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetMemoryInventoryForTest = exports.getMemoryInventorySnapshot = exports.logMemoryInventory = exports.formatMemoryInventoryLine = exports.recordHistoryFetchInventory = exports.recordMemoryInventory = exports.getMemoryInventoryContext = exports.setMemoryInventoryContext = void 0;
let inventoryContext = "unknown";
const latestByModule = new Map();
function setMemoryInventoryContext(module) {
    inventoryContext = module.trim() || "unknown";
}
exports.setMemoryInventoryContext = setMemoryInventoryContext;
function getMemoryInventoryContext() {
    return inventoryContext;
}
exports.getMemoryInventoryContext = getMemoryInventoryContext;
function recordMemoryInventory(entry) {
    const key = entry.module.trim() || inventoryContext;
    latestByModule.set(key, {
        ...entry,
        module: key,
    });
}
exports.recordMemoryInventory = recordMemoryInventory;
function recordHistoryFetchInventory(module, rowCount, options = {}) {
    recordMemoryInventory({
        module,
        checkpoint: options.queryKind ?? "history_fetch",
        historyResults: rowCount,
        daysOrSlots: options.daysOrSlots,
        arrayEntries: rowCount,
        rawHistoryRetained: false,
    });
}
exports.recordHistoryFetchInventory = recordHistoryFetchInventory;
function formatMemoryInventoryLine(entry) {
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
exports.formatMemoryInventoryLine = formatMemoryInventoryLine;
function logMemoryInventory(log, module, checkpoint) {
    const entry = latestByModule.get(module);
    if (!entry) {
        return null;
    }
    const line = formatMemoryInventoryLine({ ...entry, checkpoint: checkpoint ?? entry.checkpoint });
    log?.info?.(line);
    return entry;
}
exports.logMemoryInventory = logMemoryInventory;
function getMemoryInventorySnapshot() {
    return new Map(latestByModule);
}
exports.getMemoryInventorySnapshot = getMemoryInventorySnapshot;
function resetMemoryInventoryForTest() {
    inventoryContext = "unknown";
    latestByModule.clear();
}
exports.resetMemoryInventoryForTest = resetMemoryInventoryForTest;
