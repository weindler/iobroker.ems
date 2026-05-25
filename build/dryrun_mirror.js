"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeDryrunMirror = exports.plannedValueScalars = exports.formatValueForState = exports.DRYRUN_FLAT_STATE_SUFFIXES = void 0;
const tree_paths_1 = require("./tree_paths");
/** Dryrun-Spiegel unter addons.<addon_id>.dryrun.* */
exports.DRYRUN_FLAT_STATE_SUFFIXES = [
    {
        suffix: "timestamp",
        common: { name: "Dryrun timestamp (ISO)", type: "string", role: "text", read: true, write: false },
    },
    {
        suffix: "intent_id",
        common: { name: "Dryrun intent_id", type: "string", role: "text", read: true, write: false },
    },
    {
        suffix: "command",
        common: { name: "Dryrun command", type: "string", role: "text", read: true, write: false },
    },
    {
        suffix: "source",
        common: { name: "Dryrun source", type: "string", role: "text", read: true, write: false },
    },
    {
        suffix: "request_value",
        common: { name: "Dryrun requested value", type: "string", role: "text", read: true, write: false },
    },
    {
        suffix: "mapping_id",
        common: { name: "Dryrun mapping_id", type: "string", role: "text", read: true, write: false },
    },
    {
        suffix: "target_state",
        common: { name: "Dryrun target state (would write)", type: "string", role: "text", read: true, write: false },
    },
    {
        suffix: "planned_value",
        common: { name: "Dryrun planned value (display)", type: "string", role: "text", read: true, write: false },
    },
    {
        suffix: "planned_ampere",
        common: { name: "Dryrun planned ampere", type: "number", role: "value", read: true, write: false },
    },
    {
        suffix: "planned_watts",
        common: { name: "Dryrun planned watts", type: "number", role: "value.power", read: true, write: false },
    },
    {
        suffix: "result",
        common: { name: "Dryrun pipeline result", type: "string", role: "text", read: true, write: false },
    },
    {
        suffix: "reason",
        common: { name: "Dryrun reason", type: "string", role: "text", read: true, write: false },
    },
    {
        suffix: "addon_mode",
        common: { name: "Dryrun addon mode", type: "string", role: "text", read: true, write: false },
    },
    {
        suffix: "last_command",
        common: {
            name: "Dryrun full payload (JSON)",
            type: "string",
            role: "json",
            read: true,
            write: false,
        },
    },
];
function formatValueForState(value) {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "object")
        return JSON.stringify(value);
    return String(value);
}
exports.formatValueForState = formatValueForState;
function plannedValueScalars(planned) {
    if (planned === null || planned === undefined) {
        return { display: "" };
    }
    if (typeof planned === "number" && Number.isFinite(planned)) {
        return { display: String(planned), ampere: planned };
    }
    if (typeof planned === "object" && !Array.isArray(planned)) {
        const o = planned;
        const ampere = typeof o.ampere === "number" && Number.isFinite(o.ampere) ? o.ampere : undefined;
        const watts = typeof o.watts === "number" && Number.isFinite(o.watts) ? o.watts : undefined;
        return { display: JSON.stringify(planned), ampere, watts };
    }
    return { display: String(planned) };
}
exports.plannedValueScalars = plannedValueScalars;
async function writeDryrunMirror(writer, addonId, intent, outcome) {
    const base = (0, tree_paths_1.addonDryrunBase)(addonId);
    const ts = new Date().toISOString();
    const planned = plannedValueScalars(outcome.planned_value);
    for (const def of exports.DRYRUN_FLAT_STATE_SUFFIXES) {
        await writer.setObjectNotExistsAsync(`${base}.${def.suffix}`, {
            type: "state",
            common: { ...def.common, name: `${addonId} ${def.common.name}` },
            native: {},
        });
    }
    const values = {
        timestamp: ts,
        intent_id: intent.intent_id ?? "",
        command: intent.command,
        source: intent.source ?? "",
        request_value: formatValueForState(intent.value),
        mapping_id: outcome.mapping_id ?? "",
        target_state: outcome.target_state ?? "",
        planned_value: planned.display,
        planned_ampere: planned.ampere ?? null,
        planned_watts: planned.watts ?? null,
        result: outcome.result,
        reason: outcome.reason,
        addon_mode: outcome.addon_mode ?? "",
        last_command: JSON.stringify({ timestamp: ts, intent, outcome }),
    };
    for (const [suffix, val] of Object.entries(values)) {
        await writer.setStateAsync(`${base}.${suffix}`, { val, ack: true });
    }
}
exports.writeDryrunMirror = writeDryrunMirror;
