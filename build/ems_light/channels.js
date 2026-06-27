"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEmsLightChannels = exports.EMS_LIGHT_CHANNEL_IDS = void 0;
const state_util_1 = require("./state_util");
/** EMS-Light Kanäle (Phase 1) — ergänzt bestehenden Baum, löscht nichts. */
exports.EMS_LIGHT_CHANNEL_IDS = [
    { id: "profiles", nameDe: "EMS-Light Profile" },
    { id: "live", nameDe: "EMS-Light Live-Cache" },
    { id: "learning", nameDe: "EMS-Light Learning" },
    { id: "planner", nameDe: "EMS-Light Planner" },
    { id: "planner.intent", nameDe: "EMS-Light Planner Intents" },
    { id: "operator", nameDe: "EMS-Light Operator" },
    { id: "execution", nameDe: "EMS-Light Execution" },
    { id: "execution.dryrun", nameDe: "EMS-Light Execution Dryrun" },
    { id: "execution.safety", nameDe: "EMS-Light Execution Safety" },
    { id: "system", nameDe: "EMS-Light System" },
    { id: "economics", nameDe: "EMS-Light Economics (Reporting)" },
    { id: "global_modes", nameDe: "EMS-Light Global Modes" },
    { id: "policy", nameDe: "EMS-Light Policy" },
];
async function ensureEmsLightChannels(host) {
    for (const ch of exports.EMS_LIGHT_CHANNEL_IDS) {
        await (0, state_util_1.ensureChannel)(host, ch.id, ch.nameDe);
    }
}
exports.ensureEmsLightChannels = ensureEmsLightChannels;
