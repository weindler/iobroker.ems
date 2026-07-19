"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAddonBasisStates = exports.ensureCommandBaseStates = exports.CORE_ADDON_BASIS_IDS = void 0;
const registry_1 = require("../addons/governance/registry");
const governance_1 = require("../addons/governance");
const states_1 = require("../states");
/** Core add-ons that get enabled/available basis states (stubs stay lazy). */
exports.CORE_ADDON_BASIS_IDS = [
    ...registry_1.GOVERNED_ADDON_REGISTRY.map((e) => e.runtimeAddonId),
    "dynamic_tariff",
];
async function ensureState(host, relativeId, common, defaultVal) {
    await host.setObjectNotExistsAsync(relativeId, {
        type: "state",
        common,
        native: {},
    });
    if (defaultVal !== undefined) {
        const cur = await host.getStateAsync(relativeId);
        if (cur?.val === undefined || cur?.val === null || cur?.val === "") {
            await host.setStateAsync(relativeId, { val: defaultVal, ack: true });
        }
    }
}
/** Phase B — Command-/Audit-Basisstates. */
async function ensureCommandBaseStates(host) {
    const defs = [
        {
            _id: states_1.STATE.command.inbox,
            common: {
                name: "Command inbox (JSON)",
                type: "string",
                role: "json",
                read: true,
                write: true,
            },
        },
        {
            _id: states_1.STATE.command.lastResult,
            common: {
                name: "Last pipeline result (JSON)",
                type: "string",
                role: "json",
                read: true,
                write: false,
            },
        },
        {
            _id: states_1.STATE.audit.lastEvent,
            common: {
                name: "Last audit event (global mirror)",
                type: "string",
                role: "json",
                read: true,
                write: false,
            },
        },
    ];
    for (const def of defs) {
        await host.setObjectNotExistsAsync(def._id, {
            type: "state",
            common: def.common,
            native: {},
        });
        if (def.defVal !== undefined) {
            const cur = await host.getStateAsync(def._id);
            if (cur?.val === undefined || cur?.val === null) {
                await host.setStateAsync(def._id, { val: def.defVal, ack: true });
            }
        }
    }
}
exports.ensureCommandBaseStates = ensureCommandBaseStates;
/** Phase B — Add-on enabled/available Basisstates (nur Kern-Add-ons). */
async function ensureAddonBasisStates(host) {
    for (const addonId of exports.CORE_ADDON_BASIS_IDS) {
        const base = `addons.${addonId}`;
        const governed = (0, governance_1.governedAddonByRuntimeId)(addonId);
        await ensureState(host, `${base}.enabled`, {
            name: `${addonId} enabled`,
            type: "boolean",
            role: "switch",
            read: true,
            write: !governed,
            def: true,
        }, true);
        await ensureState(host, `${base}.available`, {
            name: `${addonId} available`,
            type: "boolean",
            role: "state",
            read: true,
            write: true,
            def: true,
        }, true);
    }
}
exports.ensureAddonBasisStates = ensureAddonBasisStates;
