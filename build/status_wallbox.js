"use strict";
/** Read-only EMS status mirror for ioBroker Vis (filled by EMS via Simple API). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureWallboxStatusStates = exports.WALLBOX_STATUS_STATES = void 0;
exports.WALLBOX_STATUS_STATES = {
    chargingMode: "status.wallbox.charging_mode",
    chargingModeLabel: "status.wallbox.charging_mode_label",
    vehicleSocPct: "status.wallbox.vehicle_soc_pct",
    updatedAt: "status.wallbox.updated_at",
};
async function ensureWallboxStatusStates(adapter) {
    const defs = [
        {
            _id: exports.WALLBOX_STATUS_STATES.chargingMode,
            common: {
                name: "Wallbox Lademodus (EMS)",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "off",
            },
            defVal: "off",
        },
        {
            _id: exports.WALLBOX_STATUS_STATES.chargingModeLabel,
            common: {
                name: "Wallbox Lademodus Anzeige (DE)",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "Aus",
            },
            defVal: "Aus",
        },
        {
            _id: exports.WALLBOX_STATUS_STATES.vehicleSocPct,
            common: {
                name: "Fahrzeug-SOC (%)",
                type: "number",
                role: "value.battery",
                unit: "%",
                read: true,
                write: false,
            },
        },
        {
            _id: exports.WALLBOX_STATUS_STATES.updatedAt,
            common: {
                name: "Status zuletzt aktualisiert (EMS)",
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
exports.ensureWallboxStatusStates = ensureWallboxStatusStates;
