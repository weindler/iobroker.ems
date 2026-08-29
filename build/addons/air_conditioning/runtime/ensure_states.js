"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAcRuntimeStates = exports.AC_RUNTIME_SUMMARY_STATES = exports.acUnitRuntimeStates = exports.acUnitRuntimeBase = exports.AC_RUNTIME_BASE = void 0;
const tree_paths_1 = require("../../../tree_paths");
const config_1 = require("../config");
const configured_1 = require("../configured");
exports.AC_RUNTIME_BASE = `${(0, tree_paths_1.addonBase)("air_conditioning")}.runtime`;
function acUnitRuntimeBase(unitIndex) {
    return `${(0, tree_paths_1.addonBase)("air_conditioning")}.units.unit_${unitIndex}`;
}
exports.acUnitRuntimeBase = acUnitRuntimeBase;
function acUnitRuntimeStates(unitIndex) {
    const base = acUnitRuntimeBase(unitIndex);
    return {
        /** Admin `ac_uN_name` — für VIS/Objektbaum lesbar. */
        name: `${base}.name`,
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
        measuredPowerW: `${base}.measured_power_w`,
        powerDisplayKind: `${base}.power_display_kind`,
        setpointTempC: `${base}.setpoint_temp_c`,
        filterStatus: `${base}.filter_status`,
        filterStatusLabelDe: `${base}.filter_status_label_de`,
        /** 0=normal, 1=wash, 2=replace, -1=fehlend/unbekannt — nur VIS/Diagnose. */
        filterStatusCode: `${base}.filter_status_code`,
        filterUsagePct: `${base}.filter_usage_pct`,
        filterUsageHours: `${base}.filter_usage_hours`,
        decisionSource: `${base}.decision_source`,
        dailyPlanStatus: `${base}.daily_plan_status`,
        dailyPlanRevision: `${base}.daily_plan_revision`,
        dailyPlanSlotStart: `${base}.daily_plan_slot_start`,
        dailyPlanSlotEnd: `${base}.daily_plan_slot_end`,
        allocatedPowerW: `${base}.allocated_power_w`,
        expectedPowerW: `${base}.expected_power_w`,
        powerModelSource: `${base}.power_model_source`,
        allocationStatus: `${base}.allocation_status`,
        allocationReasonDe: `${base}.allocation_reason_de`,
        governanceAllowed: `${base}.governance_allowed`,
        /** Klima-/Ownership-Block. */
        ownershipOwner: `${base}.ownership_owner`,
        ownershipOverrideUntilIso: `${base}.ownership_override_until_iso`,
        ownershipReasonDe: `${base}.ownership_reason_de`,
        hardOffRemainingMin: `${base}.hard_off_remaining_min`,
    };
}
exports.acUnitRuntimeStates = acUnitRuntimeStates;
exports.AC_RUNTIME_SUMMARY_STATES = {
    governanceAllowed: `${exports.AC_RUNTIME_BASE}.governance_allowed`,
    dailyPlanActive: `${exports.AC_RUNTIME_BASE}.daily_plan_active`,
    dailyPlanRevision: `${exports.AC_RUNTIME_BASE}.daily_plan_revision`,
    reasonDe: `${exports.AC_RUNTIME_BASE}.reason_de`,
    /** Klima-/Ownership-Block: gemeinsame Außengeräte-Leistung, systemweit einmal gezählt. */
    systemPowerW: `${exports.AC_RUNTIME_BASE}.system_power_w`,
    systemActiveUnitIndexes: `${exports.AC_RUNTIME_BASE}.system_active_unit_indexes`,
    systemSharedPowerUsed: `${exports.AC_RUNTIME_BASE}.system_shared_power_used`,
};
async function ensureAcRuntimeStates(host, options) {
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
    const summaryDefs = [
        {
            id: exports.AC_RUNTIME_SUMMARY_STATES.governanceAllowed,
            common: { name: "Klima Governance erlaubt", type: "boolean", role: "switch", read: true, write: false, def: false },
        },
        {
            id: exports.AC_RUNTIME_SUMMARY_STATES.dailyPlanActive,
            common: { name: "Klima Daily Plan aktiv", type: "boolean", role: "switch", read: true, write: false, def: false },
        },
        {
            id: exports.AC_RUNTIME_SUMMARY_STATES.dailyPlanRevision,
            common: { name: "Klima Daily Plan Revision", type: "number", role: "value", read: true, write: false, def: 0 },
        },
        {
            id: exports.AC_RUNTIME_SUMMARY_STATES.reasonDe,
            common: { name: "Klima Runtime Begründung", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.AC_RUNTIME_SUMMARY_STATES.systemPowerW,
            common: {
                name: "Klima Systemleistung gesamt W (Shared-Power dedupliziert)",
                type: "number",
                role: "value",
                read: true,
                write: false,
                def: 0,
                unit: "W",
            },
        },
        {
            id: exports.AC_RUNTIME_SUMMARY_STATES.systemActiveUnitIndexes,
            common: {
                name: "Klima aktuell aktive Innengeräte (Indizes, Komma-getrennt)",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "",
            },
        },
        {
            id: exports.AC_RUNTIME_SUMMARY_STATES.systemSharedPowerUsed,
            common: {
                name: "Klima Shared-Power-Messung aktuell verwendet",
                type: "boolean",
                role: "indicator",
                read: true,
                write: false,
                def: false,
            },
        },
    ];
    for (const def of summaryDefs) {
        await host.setObjectNotExistsAsync(def.id, {
            type: "state",
            common: def.common,
            native: {},
        });
    }
    const unitIndexes = options?.unitIndexes ??
        (host.config !== undefined ? (0, configured_1.configuredAcUnitIndexes)(host.config) : []);
    for (const i of unitIndexes) {
        const ch = acUnitRuntimeBase(i);
        const ids = acUnitRuntimeStates(i);
        const configuredName = host.config !== undefined ? (0, config_1.acUnitConfigFromAdapter)(host.config, i).name.trim() : "";
        const displayName = configuredName || `Innengerät ${i}`;
        const channelLabel = `Klima ${displayName}`;
        await host.setObjectNotExistsAsync(ch, {
            type: "channel",
            common: { name: channelLabel },
            native: {},
        });
        if (typeof host.extendObjectAsync === "function") {
            await host.extendObjectAsync(ch, { common: { name: channelLabel } });
        }
        const label = displayName;
        const defs = [
            { id: ids.name, common: { name: `Klima ${label} Name`, type: "string", role: "text", read: true, write: false, def: displayName } },
            { id: ids.state, common: { name: `Klima ${label} Zustand`, type: "string", role: "text", read: true, write: false, def: "disabled" } },
            { id: ids.reasonDe, common: { name: `Klima ${label} Grund`, type: "string", role: "text", read: true, write: false, def: "" } },
            { id: ids.roomTempC, common: { name: `Klima ${label} Raumtemp °C`, type: "number", role: "value", read: true, write: false } },
            { id: ids.roomHumidityPct, common: { name: `Klima ${label} Feuchte %`, type: "number", role: "value", read: true, write: false } },
            { id: ids.feedbackSwitch, common: { name: `Klima ${label} Rückmeldung`, type: "string", role: "text", read: true, write: false, def: "" } },
            { id: ids.running, common: { name: `Klima ${label} läuft`, type: "boolean", role: "state", read: true, write: false, def: false } },
            { id: ids.cleaningActive, common: { name: `Klima ${label} Reinigung`, type: "boolean", role: "state", read: true, write: false, def: false } },
            { id: ids.feedbackCleaningState, common: { name: `Klima ${label} Reinigung operatingState`, type: "string", role: "text", read: true, write: false, def: "" } },
            { id: ids.feedbackCleaningMode, common: { name: `Klima ${label} Reinigung autoCleaningMode`, type: "string", role: "text", read: true, write: false, def: "" } },
            { id: ids.feedbackCleaningProgressPct, common: { name: `Klima ${label} Reinigung Fortschritt %`, type: "number", role: "value", read: true, write: false, def: 0 } },
            { id: ids.modePurpose, common: { name: `Klima ${label} Modus-Zweck`, type: "string", role: "text", read: true, write: false, def: "cooling" } },
            { id: ids.estimatedPowerW, common: { name: `Klima ${label} geschätzte Leistung W`, type: "number", role: "value", read: true, write: false, def: 0 } },
            { id: ids.measuredPowerW, common: { name: `Klima ${label} gemessene Leistung W`, type: "number", role: "value", read: true, write: false } },
            {
                id: ids.powerDisplayKind,
                common: {
                    name: `Klima ${label} Leistungsanzeige (measured|estimated|none)`,
                    type: "string",
                    role: "text",
                    read: true,
                    write: false,
                    def: "none",
                },
            },
            { id: ids.setpointTempC, common: { name: `Klima ${label} Solltemperatur °C`, type: "number", role: "value", read: true, write: false } },
            { id: ids.filterStatus, common: { name: `Klima ${label} Filterstatus`, type: "string", role: "text", read: true, write: false, def: "" } },
            {
                id: ids.filterStatusLabelDe,
                common: { name: `Klima ${label} Filterstatus Label`, type: "string", role: "text", read: true, write: false, def: "" },
            },
            {
                id: ids.filterStatusCode,
                common: {
                    name: `Klima ${label} Filterstatus Code (0=normal,1=wash,2=replace,-1=unbekannt)`,
                    type: "number",
                    role: "value",
                    read: true,
                    write: false,
                    def: -1,
                },
            },
            { id: ids.filterUsagePct, common: { name: `Klima ${label} Filternutzung %`, type: "number", role: "value", read: true, write: false } },
            { id: ids.filterUsageHours, common: { name: `Klima ${label} Filternutzungsstunden`, type: "number", role: "value", read: true, write: false } },
            { id: ids.decisionSource, common: { name: `Klima ${label} Entscheidungsquelle`, type: "string", role: "text", read: true, write: false, def: "safe_default" } },
            { id: ids.dailyPlanStatus, common: { name: `Klima ${label} Daily-Plan-Status`, type: "string", role: "text", read: true, write: false, def: "daily_plan_missing" } },
            { id: ids.dailyPlanRevision, common: { name: `Klima ${label} Daily-Plan-Revision`, type: "number", role: "value", read: true, write: false, def: 0 } },
            { id: ids.dailyPlanSlotStart, common: { name: `Klima ${label} Daily-Plan-Slot Start`, type: "string", role: "text", read: true, write: false, def: "" } },
            { id: ids.dailyPlanSlotEnd, common: { name: `Klima ${label} Daily-Plan-Slot Ende`, type: "string", role: "text", read: true, write: false, def: "" } },
            { id: ids.allocatedPowerW, common: { name: `Klima ${label} Daily-Plan Allocation W`, type: "number", role: "value", read: true, write: false } },
            { id: ids.expectedPowerW, common: { name: `Klima ${label} erwartete Leistung W`, type: "number", role: "value", read: true, write: false } },
            { id: ids.powerModelSource, common: { name: `Klima ${label} Leistungsmodell`, type: "string", role: "text", read: true, write: false, def: "config" } },
            { id: ids.allocationStatus, common: { name: `Klima ${label} Allocation-Status`, type: "string", role: "text", read: true, write: false, def: "unknown" } },
            { id: ids.allocationReasonDe, common: { name: `Klima ${label} Allocation-Begründung`, type: "string", role: "text", read: true, write: false, def: "" } },
            { id: ids.governanceAllowed, common: { name: `Klima ${label} Governance erlaubt`, type: "boolean", role: "switch", read: true, write: false, def: false } },
            {
                id: ids.ownershipOwner,
                common: { name: `Klima ${label} Ownership (ems/user/external)`, type: "string", role: "text", read: true, write: false, def: "ems" },
            },
            {
                id: ids.ownershipOverrideUntilIso,
                common: { name: `Klima ${label} Manual-Override bis (ISO)`, type: "string", role: "text", read: true, write: false, def: "" },
            },
            {
                id: ids.ownershipReasonDe,
                common: { name: `Klima ${label} Ownership-Begründung`, type: "string", role: "text", read: true, write: false, def: "" },
            },
            {
                id: ids.hardOffRemainingMin,
                common: { name: `Klima ${label} Restzeit bis Hard-Off (Min)`, type: "number", role: "value", read: true, write: false, unit: "min" },
            },
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
