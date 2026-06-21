"use strict";
/** Hilfen zum Anlegen von States (nur setObjectNotExists, Defaults nur wenn leer). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.asBool = exports.asNum = exports.ensureStates = exports.ensureChannel = void 0;
async function ensureChannel(host, channelId, nameDe) {
    await host.setObjectNotExistsAsync(channelId, {
        type: "channel",
        common: { name: nameDe },
        native: {},
    });
}
exports.ensureChannel = ensureChannel;
async function ensureStates(host, defs) {
    for (const def of defs) {
        await host.setObjectNotExistsAsync(def.id, {
            type: "state",
            common: def.common,
            native: {},
        });
        if (def.alwaysUpdate && def.defaultVal !== undefined) {
            await host.setStateAsync(def.id, { val: def.defaultVal, ack: true });
            continue;
        }
        if (def.defaultVal === undefined || def.setDefaultIfEmpty === false) {
            continue;
        }
        const cur = await host.getStateAsync(def.id);
        if (cur?.val === undefined || cur.val === null || cur.val === "") {
            await host.setStateAsync(def.id, { val: def.defaultVal, ack: true });
        }
    }
}
exports.ensureStates = ensureStates;
function asNum(v) {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") {
        return null;
    }
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
}
exports.asNum = asNum;
function asBool(v) {
    if (typeof v === "boolean")
        return v;
    if (typeof v === "number")
        return v !== 0;
    const s = String(v ?? "").trim().toLowerCase();
    if (["1", "true", "on", "yes", "ja"].includes(s))
        return true;
    if (["0", "false", "off", "no", "nein"].includes(s))
        return false;
    return null;
}
exports.asBool = asBool;
