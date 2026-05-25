"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureImmersionStatusStates = exports.IMMERSION_STATUS_STATES = void 0;
const tree_paths_1 = require("../../tree_paths");
const STATUS = (0, tree_paths_1.addonStatusBase)("immersion_heater");
exports.IMMERSION_STATUS_STATES = {
    emsReachable: `${STATUS}.ems_reachable`,
    failsafeActive: `${STATUS}.failsafe_active`,
    failsafeWouldTrip: `${STATUS}.failsafe_would_trip`,
    lastFailsafeAt: `${STATUS}.last_failsafe_at`,
    updatedAt: `${STATUS}.updated_at`,
};
async function ensureImmersionStatusStates(adapter) {
    const defs = [
        {
            _id: exports.IMMERSION_STATUS_STATES.emsReachable,
            common: {
                name: "EMS erreichbar (Kante)",
                type: "boolean",
                role: "state",
                read: true,
                write: false,
                def: true,
            },
            defVal: true,
        },
        {
            _id: exports.IMMERSION_STATUS_STATES.failsafeActive,
            common: {
                name: "Failsafe hat Relais abgeschaltet",
                type: "boolean",
                role: "state",
                read: true,
                write: false,
                def: false,
            },
            defVal: false,
        },
        {
            _id: exports.IMMERSION_STATUS_STATES.failsafeWouldTrip,
            common: {
                name: "Failsafe würde auslösen (Dryrun-Anzeige)",
                type: "boolean",
                role: "state",
                read: true,
                write: false,
                def: false,
            },
            defVal: false,
        },
        {
            _id: exports.IMMERSION_STATUS_STATES.lastFailsafeAt,
            common: {
                name: "Letzter Failsafe (ISO)",
                type: "string",
                role: "date",
                read: true,
                write: false,
            },
        },
        {
            _id: exports.IMMERSION_STATUS_STATES.updatedAt,
            common: {
                name: "Status zuletzt aktualisiert",
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
exports.ensureImmersionStatusStates = ensureImmersionStatusStates;
