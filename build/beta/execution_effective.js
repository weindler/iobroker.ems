"use strict";
/**
 * Effektive Ausführungs-Wahrheit für Beta-UI.
 * Global dryrun → kein Add-on schreibt live (auch wenn Addon-State „live“ zeigt).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEffectiveExecutionSnapshot = void 0;
const execution_mode_1 = require("../execution_mode");
function buildEffectiveExecutionSnapshot(input) {
    const globalMode = (0, execution_mode_1.parseMode)(input.globalMode);
    const globalLive = globalMode === "live";
    const addons = {};
    const conflicts = [];
    for (const id of execution_mode_1.EXECUTION_MODE_ADDON_IDS) {
        const configuredMode = (0, execution_mode_1.parseMode)(input.addonModes[id]);
        const liveWritesPossible = globalLive && configuredMode === "live";
        addons[id] = {
            configuredMode,
            effectiveWriteMode: liveWritesPossible ? "live" : "dryrun",
            liveWritesPossible,
        };
        if (!globalLive && configuredMode === "live") {
            conflicts.push(id);
        }
    }
    let summaryDe = globalMode === "dryrun"
        ? "Ausführung: Dryrun — keine realen Gerätewrites (auch wenn einzelne Add-ons auf live stehen)."
        : "Ausführung: Live — Writes nur für Add-ons, die ebenfalls live sind und technisch freigegeben.";
    if (conflicts.length) {
        summaryDe += ` Hinweis: ${conflicts.join(", ")} als live konfiguriert, aber durch Global-Dryrun wirkungslos.`;
    }
    return { schemaVersion: 1, globalMode, globalLive, addons, summaryDe };
}
exports.buildEffectiveExecutionSnapshot = buildEffectiveExecutionSnapshot;
