"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEmsMirrorAliveState = exports.EMS_MIRROR_ALIVE_AT = void 0;
/** Optionaler EMS-Spiegel: ISO-Timestamp (EMS kann 1×/60 s schreiben). */
exports.EMS_MIRROR_ALIVE_AT = "ems_mirror.alive_at";
async function ensureEmsMirrorAliveState(host) {
    await host.setObjectNotExistsAsync(exports.EMS_MIRROR_ALIVE_AT, {
        type: "state",
        common: {
            name: "EMS zuletzt aktiv (ISO, optional vom EMS)",
            type: "string",
            role: "date",
            read: true,
            write: true,
        },
        native: {},
    });
}
exports.ensureEmsMirrorAliveState = ensureEmsMirrorAliveState;
