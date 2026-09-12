"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeEconomicsPersist = exports.readEconomicsPersist = exports.pruneEconomicsPersist = exports.ECONOMICS_DAILY_RETENTION_DAYS = exports.ECONOMICS_PERSIST_CATEGORY = exports.ECONOMICS_PERSIST_FILE = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const atomic_write_1 = require("../persistence/atomic_write");
const types_1 = require("./types");
exports.ECONOMICS_PERSIST_FILE = "economics_v1.json";
exports.ECONOMICS_PERSIST_CATEGORY = "economics";
/** Kompakter Accounting-Ledger; Detailtelemetrie hat wesentlich kürzere Retention. */
exports.ECONOMICS_DAILY_RETENTION_DAYS = 3_660;
function pruneEconomicsPersist(data, anchorDateKey, retainDays = exports.ECONOMICS_DAILY_RETENTION_DAYS) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDateKey) || !(retainDays > 0))
        return data;
    const anchor = new Date(`${anchorDateKey}T12:00:00.000Z`);
    anchor.setUTCDate(anchor.getUTCDate() - (Math.floor(retainDays) - 1));
    const cutoff = anchor.toISOString().slice(0, 10);
    const days = {};
    for (const [dateKey, day] of Object.entries(data.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey >= cutoff)
            days[dateKey] = day;
    }
    return { ...data, days };
}
exports.pruneEconomicsPersist = pruneEconomicsPersist;
async function readEconomicsPersist(dir) {
    if (!dir)
        return (0, types_1.emptyEconomicsPersist)();
    try {
        const raw = await (0, promises_1.readFile)((0, node_path_1.join)(dir, exports.ECONOMICS_PERSIST_FILE), "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.module !== types_1.ECONOMICS_MODULE || !parsed.days || typeof parsed.days !== "object") {
            return (0, types_1.emptyEconomicsPersist)();
        }
        return {
            module: types_1.ECONOMICS_MODULE,
            schemaVersion: types_1.ECONOMICS_SCHEMA_VERSION,
            updatedAtIso: typeof parsed.updatedAtIso === "string" ? parsed.updatedAtIso : new Date(0).toISOString(),
            days: parsed.days,
        };
    }
    catch {
        return (0, types_1.emptyEconomicsPersist)();
    }
}
exports.readEconomicsPersist = readEconomicsPersist;
async function writeEconomicsPersist(dir, data, anchorDateKey) {
    await (0, promises_1.mkdir)(dir, { recursive: true });
    const latestKey = Object.keys(data.days).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort().at(-1);
    const anchor = anchorDateKey ?? latestKey;
    const compacted = anchor ? pruneEconomicsPersist(data, anchor) : data;
    data.days = compacted.days;
    const next = { ...data, updatedAtIso: new Date().toISOString() };
    await (0, atomic_write_1.atomicWriteFile)((0, node_path_1.join)(dir, exports.ECONOMICS_PERSIST_FILE), `${JSON.stringify(next)}\n`, {
        mode: atomic_write_1.DIAGNOSTIC_FILE_MODE,
    });
}
exports.writeEconomicsPersist = writeEconomicsPersist;
