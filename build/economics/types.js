"use strict";
/**
 * PHASE 7 — Wirtschaftlichkeit. Drei Effekte strikt getrennt, nie schönrechnen:
 *   1. Tarifvorteil  — dynamischer Tarif vs. Festtarif (bestehende Statistik)
 *   2. EMS-Vorteil   — reference_no_ems vs. real (Shadow Engine)
 *   3. KI-Mehrwert   — ems_without_ai vs. real (Shadow Engine; kann negativ sein)
 *
 * Der KI-Euro-Wert stammt AUSSCHLIESSLICH aus der deterministischen Shadow-Berechnung — nie aus
 * einer LLM-Selbsteinschätzung. Grid Rewards separat, nie mit dem Tarifvorteil vermischt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyEconomicsPersist = exports.ECONOMICS_SCHEMA_VERSION = exports.ECONOMICS_MODULE = void 0;
exports.ECONOMICS_MODULE = "economics";
exports.ECONOMICS_SCHEMA_VERSION = 1;
function emptyEconomicsPersist(now = new Date()) {
    return { module: exports.ECONOMICS_MODULE, schemaVersion: exports.ECONOMICS_SCHEMA_VERSION, updatedAtIso: now.toISOString(), days: {} };
}
exports.emptyEconomicsPersist = emptyEconomicsPersist;
