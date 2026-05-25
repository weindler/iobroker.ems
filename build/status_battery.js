"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureBatteryStatusStates = exports.BATTERY_STATUS_STATES = void 0;
const tree_paths_1 = require("./tree_paths");
/** Batterie-Status (Controller + Spiegel für Vis). */
const STATUS = (0, tree_paths_1.addonStatusBase)("battery");
exports.BATTERY_STATUS_STATES = {
    controller: `${STATUS}.controller`,
    gridBalanceEnabled: `${STATUS}.grid_balance_enabled`,
    updatedAt: `${STATUS}.updated_at`,
    modeSequenceStatus: `${STATUS}.mode_sequence_status`,
    modeSequenceDetail: `${STATUS}.mode_sequence_detail`,
    emsReachable: `${STATUS}.ems_reachable`,
    actuatorReachable: `${STATUS}.actuator_reachable`,
    addonDead: `${STATUS}.addon_dead`,
    failsafeActive: `${STATUS}.failsafe_active`,
    failsafeWouldTrip: `${STATUS}.failsafe_would_trip`,
    lastFailsafeAt: `${STATUS}.last_failsafe_at`,
};
async function ensureBatteryStatusStates(adapter) {
    const defs = [
        {
            _id: exports.BATTERY_STATUS_STATES.controller,
            common: {
                name: "Batterie-Controller (idle|grid_balance|ems)",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "idle",
            },
            defVal: "idle",
        },
        {
            _id: exports.BATTERY_STATUS_STATES.gridBalanceEnabled,
            common: {
                name: "Netzausgleich aktiv (EMS-Spiegel)",
                type: "boolean",
                role: "state",
                read: true,
                write: false,
                def: false,
            },
            defVal: false,
        },
        {
            _id: exports.BATTERY_STATUS_STATES.updatedAt,
            common: {
                name: "Batterie-Status zuletzt aktualisiert",
                type: "string",
                role: "date",
                read: true,
                write: false,
            },
        },
        {
            _id: exports.BATTERY_STATUS_STATES.modeSequenceStatus,
            common: {
                name: "Modus-Sequenz Status",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "idle",
            },
            defVal: "idle",
        },
        {
            _id: exports.BATTERY_STATUS_STATES.modeSequenceDetail,
            common: {
                name: "Modus-Sequenz Detail",
                type: "string",
                role: "text",
                read: true,
                write: false,
            },
        },
        {
            _id: exports.BATTERY_STATUS_STATES.emsReachable,
            common: {
                name: "EMS erreichbar",
                type: "boolean",
                role: "state",
                read: true,
                write: false,
                def: true,
            },
            defVal: true,
        },
        {
            _id: exports.BATTERY_STATUS_STATES.actuatorReachable,
            common: {
                name: "Sonnen-Aktor erreichbar (Readback)",
                type: "boolean",
                role: "state",
                read: true,
                write: false,
                def: true,
            },
            defVal: true,
        },
        {
            _id: exports.BATTERY_STATUS_STATES.addonDead,
            common: {
                name: "Batterie tot — EMS soll keine Writes senden",
                type: "boolean",
                role: "state",
                read: true,
                write: false,
                def: false,
            },
            defVal: false,
        },
        {
            _id: exports.BATTERY_STATUS_STATES.failsafeActive,
            common: {
                name: "Failsafe Modus 2 erzwungen",
                type: "boolean",
                role: "state",
                read: true,
                write: false,
                def: false,
            },
            defVal: false,
        },
        {
            _id: exports.BATTERY_STATUS_STATES.failsafeWouldTrip,
            common: {
                name: "Failsafe würde auslösen (Dryrun)",
                type: "boolean",
                role: "state",
                read: true,
                write: false,
                def: false,
            },
            defVal: false,
        },
        {
            _id: exports.BATTERY_STATUS_STATES.lastFailsafeAt,
            common: {
                name: "Letzter Failsafe (ISO)",
                type: "string",
                role: "date",
                read: true,
                write: false,
            },
        },
    ];
    for (const def of defs) {
        await adapter.setObjectNotExistsAsync(def._id, {
            type: "state",
            common: def.common,
            native: {},
        });
        if (def.defVal !== undefined) {
            const cur = await adapter.getStateAsync(def._id);
            if (cur?.val === undefined || cur.val === null || cur.val === "") {
                await adapter.setStateAsync(def._id, { val: def.defVal, ack: true });
            }
        }
    }
}
exports.ensureBatteryStatusStates = ensureBatteryStatusStates;
