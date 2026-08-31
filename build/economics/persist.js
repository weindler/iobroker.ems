"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeEconomicsPersist = exports.readEconomicsPersist = exports.ECONOMICS_PERSIST_CATEGORY = exports.ECONOMICS_PERSIST_FILE = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const atomic_write_1 = require("../persistence/atomic_write");
const types_1 = require("./types");
exports.ECONOMICS_PERSIST_FILE = "economics_v1.json";
exports.ECONOMICS_PERSIST_CATEGORY = "economics";
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
async function writeEconomicsPersist(dir, data) {
    await (0, promises_1.mkdir)(dir, { recursive: true });
    const next = { ...data, updatedAtIso: new Date().toISOString() };
    await (0, atomic_write_1.atomicWriteFile)((0, node_path_1.join)(dir, exports.ECONOMICS_PERSIST_FILE), `${JSON.stringify(next)}\n`, {
        mode: atomic_write_1.DIAGNOSTIC_FILE_MODE,
    });
}
exports.writeEconomicsPersist = writeEconomicsPersist;
