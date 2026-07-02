"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreLearningPersistenceFromStates = exports.mirrorLearningPersistenceToStates = exports.ensureLearningPersistenceStates = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const state_util_1 = require("../ems_light/state_util");
const ARTIFACTS = [
    {
        key: "battery_runtime",
        category: "learning/battery_runtime",
        fileName: "battery_runtime_learning_v1.json",
        nameDe: "Battery-Runtime-Learning (Backup-Spiegel)",
    },
    {
        key: "house_load",
        category: "learning/house_load",
        fileName: "house_load_learning_v1.json",
        nameDe: "Hauslast-Learning (Backup-Spiegel)",
    },
    {
        key: "thermal_runtime",
        category: "learning/thermal_runtime",
        fileName: "thermal_runtime_learning_v1.json",
        nameDe: "Thermal-Runtime-Learning (Backup-Spiegel)",
    },
    {
        key: "price_learning",
        category: "learning/price_learning",
        fileName: "price_learning_v1.json",
        nameDe: "Preis-Learning (Backup-Spiegel)",
    },
    {
        key: "price_forecast",
        category: "learning/price_forecast",
        fileName: "price_forecast_learning_v1.json",
        nameDe: "Preis-Forecast-Learning (Backup-Spiegel)",
    },
    {
        key: "pv_bias_daily",
        category: "learning/pv_bias",
        fileName: "pv_bias_daily_v1.json",
        nameDe: "PV-Bias Tages-Snapshots (Backup-Spiegel)",
    },
    {
        key: "power_hourly",
        category: "learning/power_rollup",
        fileName: "power_hourly_v1.json",
        nameDe: "Power-Stunden-Rollup (Backup-Spiegel)",
    },
];
const BASE = "learning.persistence";
function mirrorStateId(key) {
    return `${BASE}.${key}_json`;
}
async function ensureLearningPersistenceStates(host) {
    await (0, state_util_1.ensureChannel)(host, BASE, "Learning-Persistenz (Backup-Spiegel)");
    const defs = ARTIFACTS.map((a) => ({
        id: mirrorStateId(a.key),
        common: {
            name: a.nameDe,
            type: "string",
            role: "json",
            read: true,
            write: false,
        },
    }));
    defs.push({
        id: `${BASE}.last_mirror`,
        common: { name: "Letzte Spiegelung", type: "string", role: "value.time", read: true, write: false },
    }, {
        id: `${BASE}.last_restore`,
        common: { name: "Letzte Wiederherstellung", type: "string", role: "value.time", read: true, write: false },
    });
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureLearningPersistenceStates = ensureLearningPersistenceStates;
/** Datei-Zusammenfassungen in die Spiegel-States schreiben (ack=true). */
async function mirrorLearningPersistenceToStates(host) {
    if (typeof host.getAbsolutePath !== "function") {
        return;
    }
    let mirrored = 0;
    for (const a of ARTIFACTS) {
        try {
            const filePath = path.join(host.getAbsolutePath(a.category), a.fileName);
            const raw = await fs.readFile(filePath, "utf8");
            await host.setStateAsync(mirrorStateId(a.key), { val: raw, ack: true });
            mirrored++;
        }
        catch {
            // Datei existiert (noch) nicht — vorhandenen Spiegel-State unangetastet lassen.
        }
    }
    if (mirrored > 0) {
        await host.setStateAsync(`${BASE}.last_mirror`, { val: new Date().toISOString(), ack: true });
    }
}
exports.mirrorLearningPersistenceToStates = mirrorLearningPersistenceToStates;
/**
 * Fehlende Zusammenfassungs-Dateien aus den Spiegel-States wiederherstellen.
 * Nur schreiben, wenn die Datei fehlt und der State gültiges JSON enthält.
 */
async function restoreLearningPersistenceFromStates(host) {
    if (typeof host.getAbsolutePath !== "function") {
        return;
    }
    let restored = 0;
    for (const a of ARTIFACTS) {
        try {
            const dir = host.getAbsolutePath(a.category);
            const filePath = path.join(dir, a.fileName);
            let fileExists = true;
            try {
                await fs.access(filePath);
            }
            catch {
                fileExists = false;
            }
            if (fileExists) {
                continue;
            }
            const st = await host.getStateAsync(mirrorStateId(a.key));
            const val = st?.val;
            if (typeof val !== "string" || val.trim() === "") {
                continue;
            }
            try {
                JSON.parse(val);
            }
            catch {
                continue;
            }
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filePath, val.endsWith("\n") ? val : `${val}\n`, "utf8");
            restored++;
            host.log.info(`Learning-Persistenz: ${a.fileName} aus Backup-State wiederhergestellt`);
        }
        catch (e) {
            host.log.warn(`Learning-Persistenz restore ${a.key}: ${e instanceof Error ? e.message : e}`);
        }
    }
    if (restored > 0) {
        await host.setStateAsync(`${BASE}.last_restore`, { val: new Date().toISOString(), ack: true });
    }
}
exports.restoreLearningPersistenceFromStates = restoreLearningPersistenceFromStates;
