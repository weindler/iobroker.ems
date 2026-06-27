"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProvenanceMap = void 0;
function collectFromSection(section, out, prefix) {
    for (const key of Object.keys(section).sort()) {
        const pv = section[key];
        if (!pv) {
            continue;
        }
        out[`${prefix}.${key}`] = pv.source;
    }
}
/** Flache Herkunftsübersicht für policy.*.provenance_json */
function buildProvenanceMap(snapshot) {
    const out = {};
    collectFromSection(snapshot.capabilities, out, "capabilities");
    collectFromSection(snapshot.limits, out, "limits");
    collectFromSection(snapshot.preferences, out, "preferences");
    collectFromSection(snapshot.protection, out, "protection");
    collectFromSection(snapshot.economics, out, "economics");
    return out;
}
exports.buildProvenanceMap = buildProvenanceMap;
