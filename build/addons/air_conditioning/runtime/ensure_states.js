"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAcRuntimeStates = exports.acUnitRuntimeStates = exports.acUnitRuntimeBase = exports.AC_RUNTIME_BASE = void 0;
const tree_paths_1 = require("../../../tree_paths");
const constants_1 = require("../constants");
exports.AC_RUNTIME_BASE = `${(0, tree_paths_1.addonBase)("air_conditioning")}.runtime`;
function acUnitRuntimeBase(unitIndex) {
    return `${(0, tree_paths_1.addonBase)("air_conditioning")}.units.unit_${unitIndex}`;
}
exports.acUnitRuntimeBase = acUnitRuntimeBase;
function acUnitRuntimeStates(unitIndex) {
    const base = acUnitRuntimeBase(unitIndex);
    return {
        state: `${base}.state`,
        reasonDe: `${base}.reason_de`,
        roomTempC: `${base}.room_temp_c`,
        roomHumidityPct: `${base}.room_humidity_pct`,
        feedbackSwitch: `${base}.feedback_switch`,
        running: `${base}.running`,
        cleaningActive: `${base}.cleaning_active`,
        feedbackCleaningState: `${base}.feedback_cleaning_state`,
        feedbackCleaningMode: `${base}.feedback_cleaning_mode`,
        feedbackCleaningProgressPct: `${base}.feedback_cleaning_progress_pct`,
        modePurpose: `${base}.mode_purpose`,
        estimatedPowerW: `${base}.estimated_power_w`,
    };
}
exports.acUnitRuntimeStates = acUnitRuntimeStates;
async function ensureAcRuntimeStates(host) {
    await host.setObjectNotExistsAsync(`${(0, tree_paths_1.addonBase)("air_conditioning")}.units`, {
        type: "channel",
        common: { name: "Klima Innengeräte" },
        native: {},
    });
    await host.setObjectNotExistsAsync(exports.AC_RUNTIME_BASE, {
        type: "channel",
        common: { name: "Klima Runtime" },
        native: {},
    });
    await host.setObjectNotExistsAsync(`${exports.AC_RUNTIME_BASE}.outdoor_allocated_power_w`, {
        type: "state",
        common: {
            name: "Klima Außengerät zugeordnete Leistung W",
            type: "number",
            role: "value",
            read: true,
            write: false,
            unit: "W",
        },
        native: {},
    });
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        const ch = acUnitRuntimeBase(i);
        const ids = acUnitRuntimeStates(i);
        await host.setObjectNotExistsAsync(ch, {
            type: "channel",
            common: { name: `Klima Unit ${i}` },
            native: {},
        });
        const defs = [
            { id: ids.state, common: { name: `Klima ${i} Zustand`, type: "string", role: "text", read: true, write: false, def: "disabled" } },
            { id: ids.reasonDe, common: { name: `Klima ${i} Grund`, type: "string", role: "text", read: true, write: false, def: "" } },
            { id: ids.roomTempC, common: { name: `Klima ${i} Raumtemp °C`, type: "number", role: "value", read: true, write: false } },
            { id: ids.roomHumidityPct, common: { name: `Klima ${i} Feuchte %`, type: "number", role: "value", read: true, write: false } },
            { id: ids.feedbackSwitch, common: { name: `Klima ${i} Rückmeldung`, type: "string", role: "text", read: true, write: false, def: "" } },
            { id: ids.running, common: { name: `Klima ${i} läuft`, type: "boolean", role: "state", read: true, write: false, def: false } },
            { id: ids.cleaningActive, common: { name: `Klima ${i} Reinigung`, type: "boolean", role: "state", read: true, write: false, def: false } },
            { id: ids.feedbackCleaningState, common: { name: `Klima ${i} Reinigung operatingState`, type: "string", role: "text", read: true, write: false, def: "" } },
            { id: ids.feedbackCleaningMode, common: { name: `Klima ${i} Reinigung autoCleaningMode`, type: "string", role: "text", read: true, write: false, def: "" } },
            { id: ids.feedbackCleaningProgressPct, common: { name: `Klima ${i} Reinigung Fortschritt %`, type: "number", role: "value", read: true, write: false, def: 0 } },
            { id: ids.modePurpose, common: { name: `Klima ${i} Modus-Zweck`, type: "string", role: "text", read: true, write: false, def: "cooling" } },
            { id: ids.estimatedPowerW, common: { name: `Klima ${i} geschätzte Leistung W`, type: "number", role: "value", read: true, write: false, def: 0 } },
        ];
        for (const def of defs) {
            await host.setObjectNotExistsAsync(def.id, {
                type: "state",
                common: def.common,
                native: {},
            });
        }
    }
}
exports.ensureAcRuntimeStates = ensureAcRuntimeStates;
