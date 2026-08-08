"use strict";
/**
 * Effektive Ausführungs-Wahrheit für Beta-UI.
 *
 * Hierarchie:
 * - Global Dryrun → alle Add-ons effektiv dryrun (auch wenn Add-on „live“ zeigt)
 * - Global Live → Add-on schreibt nur, wenn es selbst live ist
 *
 * Modes werden hier nicht mutiert — nur die kombinierte Wirkung dargestellt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEffectiveExecutionSnapshot = void 0;
const execution_mode_1 = require("../execution_mode");
function buildEffectiveExecutionSnapshot(input) {
    const globalMode = (0, execution_mode_1.parseMode)(input.globalMode);
    const globalLive = globalMode === "live";
    const addons = {};
    const blockedByGlobal = [];
    const blockedByAddon = [];
    for (const id of execution_mode_1.EXECUTION_MODE_ADDON_IDS) {
        const configuredMode = (0, execution_mode_1.parseMode)(input.addonModes[id]);
        const liveWritesPossible = globalLive && configuredMode === "live";
        let blockReasonDe = null;
        if (!globalLive) {
            blockReasonDe = "Global Dryrun";
            if (configuredMode === "live")
                blockedByGlobal.push(id);
        }
        else if (configuredMode !== "live") {
            blockReasonDe = "Add-on Dryrun";
            blockedByAddon.push(id);
        }
        addons[id] = {
            configuredMode,
            effectiveWriteMode: liveWritesPossible ? "live" : "dryrun",
            liveWritesPossible,
            blockReasonDe,
        };
    }
    let summaryDe;
    if (!globalLive) {
        summaryDe =
            "Ausführung: Global Dryrun — keine realen Gerätewrites (sperrt alle Add-ons).";
        if (blockedByGlobal.length) {
            summaryDe += ` Hinweis: ${blockedByGlobal.join(", ")} steht auf live, ist aber durch Global Dryrun wirkungslos.`;
        }
    }
    else {
        summaryDe =
            "Ausführung: Global Live — Writes nur für Add-ons, die selbst auf Live stehen und technisch freigegeben sind.";
        if (blockedByAddon.length) {
            summaryDe += ` Dryrun: ${blockedByAddon.join(", ")}.`;
        }
    }
    return { schemaVersion: 1, globalMode, globalLive, addons, summaryDe };
}
exports.buildEffectiveExecutionSnapshot = buildEffectiveExecutionSnapshot;
