"use strict";
/**
 * Effektive Ausführungs-Wahrheit für Beta-UI.
 *
 * Hierarchie:
 * - Global Dryrun → keine Writes (Add-on live plant weiter)
 * - Global Live + Add-on off → keine Participation/Writes
 * - Global Live + Add-on dryrun → planen, keine Writes
 * - Global Live + Add-on live → Writes möglich
 *
 * Modes werden hier nicht mutiert — nur die kombinierte Wirkung dargestellt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEffectiveExecutionSnapshot = void 0;
const execution_mode_1 = require("../execution_mode");
function buildEffectiveExecutionSnapshot(input) {
    const globalMode = (0, execution_mode_1.parseGlobalMode)(input.globalMode);
    const globalLive = globalMode === "live";
    const addons = {};
    const blockedByGlobal = [];
    const blockedByAddonDryrun = [];
    const blockedByAddonOff = [];
    for (const id of execution_mode_1.EXECUTION_MODE_ADDON_IDS) {
        const configuredMode = (0, execution_mode_1.parseAddonMode)(input.addonModes[id]);
        const liveWritesPossible = globalLive && configuredMode === "live";
        let blockReasonDe = null;
        let effectiveWriteMode = "dryrun";
        if (configuredMode === "off") {
            effectiveWriteMode = "off";
            blockReasonDe = "Add-on Aus — EMS übernimmt nicht";
            blockedByAddonOff.push(id);
        }
        else if (!globalLive) {
            effectiveWriteMode = "dryrun";
            blockReasonDe = "Global Dryrun";
            if (configuredMode === "live")
                blockedByGlobal.push(id);
        }
        else if (configuredMode === "dryrun") {
            effectiveWriteMode = "dryrun";
            blockReasonDe = "Add-on Dryrun";
            blockedByAddonDryrun.push(id);
        }
        else {
            effectiveWriteMode = "live";
            blockReasonDe = null;
        }
        addons[id] = {
            configuredMode,
            effectiveWriteMode,
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
        if (blockedByAddonOff.length) {
            summaryDe += ` Aus: ${blockedByAddonOff.join(", ")}.`;
        }
        if (blockedByAddonDryrun.length) {
            summaryDe += ` Dryrun: ${blockedByAddonDryrun.join(", ")}.`;
        }
    }
    return { schemaVersion: 1, globalMode, globalLive, addons, summaryDe };
}
exports.buildEffectiveExecutionSnapshot = buildEffectiveExecutionSnapshot;
