"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.immersionCriticalNow = exports.resolveAllBatteryConsumerAccess = exports.resolveBatteryConsumerAccess = void 0;
const config_1 = require("./config");
/**
 * Deterministic gate: may this consumer draw house-battery energy right now?
 * Operator + Allocation must call this — never a silent addon-side write around EVCC.
 */
function resolveBatteryConsumerAccess(input) {
    const { consumerId, rule, batteryHoldActive, socPct, criticalNow } = input;
    const base = {
        consumerId,
        mayUseBattery: rule.mayUseBattery,
        onlyWhenCritical: rule.onlyWhenCritical,
        criticalNow,
        minSocPct: rule.minSocPct,
        socPct,
        batteryHoldActive,
    };
    if (!rule.mayUseBattery) {
        return { ...base, allowed: false, reasonDe: "Policy: Batterie für diesen Verbraucher nicht erlaubt." };
    }
    if (batteryHoldActive) {
        return {
            ...base,
            allowed: false,
            reasonDe: "Batterie-Hold aktiv (EVCC/Intent) — kein Verbraucher-Zugriff.",
        };
    }
    if (rule.minSocPct !== null) {
        if (socPct === null) {
            return { ...base, allowed: false, reasonDe: "SOC unbekannt — Batteriezugriff gesperrt." };
        }
        if (socPct <= rule.minSocPct) {
            return {
                ...base,
                allowed: false,
                reasonDe: `SOC ${socPct.toFixed(0)} % ≤ Boden ${rule.minSocPct} % — Batteriezugriff gesperrt.`,
            };
        }
    }
    if (rule.onlyWhenCritical) {
        if (criticalNow === null) {
            return {
                ...base,
                allowed: false,
                reasonDe: "Nur-kritisch: kritischer Zustand unbekannt — kein Batteriezugriff.",
            };
        }
        if (!criticalNow) {
            return {
                ...base,
                allowed: false,
                reasonDe: "Nur-kritisch: Zustand nicht kritisch — nur PV/Policy-Netz.",
            };
        }
    }
    return {
        ...base,
        allowed: true,
        reasonDe: rule.onlyWhenCritical
            ? "Batterie für kritischen Verbraucherbedarf freigegeben."
            : "Batterie für Verbraucher freigegeben.",
    };
}
exports.resolveBatteryConsumerAccess = resolveBatteryConsumerAccess;
function resolveAllBatteryConsumerAccess(input) {
    const ids = ["immersion_heater", "air_conditioning", "wallbox"];
    const out = {};
    for (const id of ids) {
        out[id] = resolveBatteryConsumerAccess({
            consumerId: id,
            rule: (0, config_1.batteryConsumerRule)(input.config, id),
            batteryHoldActive: input.batteryHoldActive,
            socPct: input.socPct,
            criticalNow: input.criticalByConsumer[id] ?? null,
        });
    }
    return out;
}
exports.resolveAllBatteryConsumerAccess = resolveAllBatteryConsumerAccess;
/** Immersion critical: buffer at or below planningMin + margin. */
function immersionCriticalNow(bufferTempC, planningMinTempC, criticalMarginK) {
    if (bufferTempC === null)
        return null;
    const margin = criticalMarginK ?? 0;
    return bufferTempC <= planningMinTempC + margin;
}
exports.immersionCriticalNow = immersionCriticalNow;
