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
exports.buildClimateTabItems = exports.buildClimateUnitItems = void 0;
/**
 * Admin-UI-Generator für den Klima-Tab (5× identische Innengerät-Blöcke).
 *
 * Statt 5 fast identische Blöcke von Hand in admin/jsonConfig.json zu pflegen
 * (Block 3 des Aufräum-Fahrplans, s. docs/README.md), wird jeder Block aus
 * `climate_unit_shape.ts` (Struktur, für alle 5 Geräte identisch) plus
 * `climate_unit_defaults.ts` (individuelle Default-Werte je Gerät) erzeugt.
 *
 * Nutzung:
 *   npm run admin-config:generate   — schreibt admin/jsonConfig.json neu
 *   npm run admin-config:check      — prüft nur, ob die Datei dem Template
 *                                      entspricht (Exit-Code 1 bei Drift,
 *                                      Teil von `npm test` / CI)
 *
 * Alles außerhalb des Klima-Tabs (andere Tabs) sowie die 6 globalen Klima-Felder
 * (introAc, climateGovernanceHint, ac_addon_mode, ac_outdoor_max_power_w,
 * ac_planner_outdoor_likely_temp_c, ac_default_profile) bleiben unverändert.
 */
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const climate_unit_shape_1 = require("./climate_unit_shape");
const climate_unit_defaults_1 = require("./climate_unit_defaults");
const CLIMATE_UNIT_COUNT = 5;
const GLOBAL_CLIMATE_KEYS = [
    "introAc",
    "climateGovernanceHint",
    "ac_addon_mode",
    "ac_outdoor_max_power_w",
    "ac_planner_outdoor_likely_temp_c",
    "ac_default_profile",
];
function isOverrideMarker(value) {
    return (value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof value.__override__ === "string");
}
/**
 * Fällt der individuelle Default-Wert für ein noch unkonfiguriertes Gerät (3-5) auf
 * null/undefined, wird das Feld ganz weggelassen — analog zum bisherigen Datenstand,
 * wo unkonfigurierte Geräte gar kein "default" fürs jeweilige Feld hatten.
 */
function fillTemplateValue(value, unitNumber, overrides) {
    if (typeof value === "string") {
        return value.replace(/\{N\}/g, String(unitNumber));
    }
    if (Array.isArray(value)) {
        return value.map((v) => fillTemplateValue(v, unitNumber, overrides));
    }
    if (value !== null && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (isOverrideMarker(v)) {
                const suffix = v.__override__;
                if (!(suffix in overrides)) {
                    throw new Error(`admin_config generator: missing override "${suffix}" in climate_unit_defaults.ts`);
                }
                const overrideValue = overrides[suffix];
                if (overrideValue === null || overrideValue === undefined)
                    continue;
                out[k] = overrideValue;
                continue;
            }
            out[k] = fillTemplateValue(v, unitNumber, overrides);
        }
        return out;
    }
    return value;
}
function buildClimateUnitItems(unitNumber) {
    const overrides = climate_unit_defaults_1.CLIMATE_UNIT_DEFAULTS[String(unitNumber)];
    if (!overrides) {
        throw new Error(`admin_config generator: no defaults for unit ${unitNumber}`);
    }
    return climate_unit_shape_1.CLIMATE_UNIT_SHAPE.map(([templatedKey, templatedValue]) => {
        const key = templatedKey.replace(/\{N\}/g, String(unitNumber));
        const value = fillTemplateValue(templatedValue, unitNumber, overrides);
        return [key, value];
    });
}
exports.buildClimateUnitItems = buildClimateUnitItems;
function buildClimateTabItems(existingItems) {
    const out = {};
    for (const key of GLOBAL_CLIMATE_KEYS) {
        if (!(key in existingItems)) {
            throw new Error(`admin_config generator: expected global climate key "${key}" missing in jsonConfig.json`);
        }
        out[key] = existingItems[key];
    }
    for (let unit = 1; unit <= CLIMATE_UNIT_COUNT; unit++) {
        for (const [key, value] of buildClimateUnitItems(unit)) {
            out[key] = value;
        }
    }
    return out;
}
exports.buildClimateTabItems = buildClimateTabItems;
function jsonConfigPath() {
    // Läuft aus build/tools/admin_config/generate.js — Repo-Root ist vier Ebenen höher.
    return path.resolve(__dirname, "..", "..", "..", "admin", "jsonConfig.json");
}
/**
 * Findet das schließende "}" zum "{" bei openIdx (stringsicher, respektiert Escapes).
 * Der Rest der Datei (andere Tabs, Formatierung) bleibt dadurch komplett unberührt —
 * es wird NICHT die gesamte Datei neu serialisiert, sondern nur der Klima-Items-Block
 * textuell ersetzt.
 */
function findMatchingBrace(text, openIdx) {
    let depth = 0;
    let inString = false;
    for (let i = openIdx; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            if (c === "\\") {
                i++;
                continue;
            }
            if (c === '"')
                inString = false;
            continue;
        }
        if (c === '"') {
            inString = true;
            continue;
        }
        if (c === "{")
            depth++;
        else if (c === "}") {
            depth--;
            if (depth === 0)
                return i;
        }
    }
    throw new Error(`admin_config generator: unbalanced braces from index ${openIdx}`);
}
function findObjectValueSpan(text, keyLiteral, fromIndex) {
    const keyIdx = text.indexOf(keyLiteral, fromIndex);
    if (keyIdx === -1)
        throw new Error(`admin_config generator: key ${keyLiteral} not found`);
    const colonIdx = text.indexOf(":", keyIdx + keyLiteral.length);
    const openIdx = text.indexOf("{", colonIdx);
    const closeIdx = findMatchingBrace(text, openIdx);
    return { openIdx, closeIdx };
}
function main() {
    const checkOnly = process.argv.includes("--check");
    const filePath = jsonConfigPath();
    const raw = fs.readFileSync(filePath, "utf8");
    const cfg = JSON.parse(raw);
    const climateTab = cfg.items.climateTab;
    if (!climateTab || typeof climateTab.items !== "object") {
        throw new Error("admin_config generator: climateTab.items not found in jsonConfig.json");
    }
    const generatedClimateItems = buildClimateTabItems(climateTab.items);
    const bodyJson = JSON.stringify(generatedClimateItems, null, "\t");
    const reindented = bodyJson
        .split("\n")
        .map((line, idx) => (idx === 0 ? line : `\t\t\t${line}`))
        .join("\n");
    const climateTabSpan = findObjectValueSpan(raw, '"climateTab"', 0);
    const itemsSpan = findObjectValueSpan(raw, '"items"', climateTabSpan.openIdx);
    if (itemsSpan.closeIdx > climateTabSpan.closeIdx) {
        throw new Error("admin_config generator: climateTab.items span exceeds climateTab span — aborting");
    }
    const generatedRaw = raw.slice(0, itemsSpan.openIdx) + reindented + raw.slice(itemsSpan.closeIdx + 1);
    if (checkOnly) {
        if (generatedRaw !== raw) {
            process.stderr.write("admin_config check: admin/jsonConfig.json (Klima-Tab) ist nicht mehr aus dem Template generiert.\n" +
                "Manuelle Änderungen an ac_u<N>_*/hAcU<N>* bitte in climate_unit_shape.ts bzw.\n" +
                "climate_unit_defaults.ts vornehmen und dann `npm run admin-config:generate` ausführen.\n");
            process.exitCode = 1;
            return;
        }
        process.stdout.write("admin_config check: OK — Klima-Tab entspricht dem Template.\n");
        return;
    }
    fs.writeFileSync(filePath, generatedRaw, "utf8");
    process.stdout.write(`admin_config generate: admin/jsonConfig.json aktualisiert (${filePath}).\n`);
}
if (require.main === module) {
    main();
}
