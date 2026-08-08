"use strict";
/**
 * Learning → Admin-Config Reconciliation für AC estimated_power_w.
 *
 * Learned Power gilt sofort für Planner/Runtime (resolveConsumerEffectivePowerW).
 * Persistierter Admin-Nominal wird nur pending vorgemerkt.
 *
 * updateConfig() → js-controller Instanz-Neustart. Deshalb Flush NUR wenn:
 * - global.execution_mode != live (Dryrun/off)
 * - kein Restore aktiv
 * - optional: keine laufende AC-/Heizstab-Aktion
 * Alle Units gebündelt in einem updateConfig. Nie automatisch während Global Live.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushQueuedAcPowerConfigReconcile = exports.isSafeForAcConfigRestart = exports.queueAcPowerConfigReconcile = exports.getPendingAcPowerReconcileForTests = exports.resetAcPowerReconcileMemoryForTests = exports.evaluateAcPowerConfigReconcile = exports.AC_POWER_RECONCILE_COOLDOWN_MS = exports.AC_POWER_RECONCILE_MIN_REL_DELTA = exports.AC_POWER_RECONCILE_MIN_ABS_DELTA_W = exports.AC_POWER_RECONCILE_MAX_REL_SPAN = exports.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS = void 0;
const learned_power_1 = require("../../../learning/consumer_stats/learned_power");
const execution_mode_1 = require("../../../execution_mode");
const barrier_1 = require("../../../restore/barrier");
const tree_paths_1 = require("../../../tree_paths");
/** Strenger als Runtime-Learned (3): Admin-Write braucht mehr unabhängige Tage. */
exports.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS = 5;
/** Relative Spannweite (max−min)/median — darüber gilt Learning als instabil. */
exports.AC_POWER_RECONCILE_MAX_REL_SPAN = 0.18;
/** Mindestabweichung abs. (W) für „relevant“. */
exports.AC_POWER_RECONCILE_MIN_ABS_DELTA_W = 10;
/** Mindestabweichung relativ zur Config. */
exports.AC_POWER_RECONCILE_MIN_REL_DELTA = 0.02;
/** Mindestabstand zwischen Config-Writes (kein Sample-Spam / Restart-Sturm). */
exports.AC_POWER_RECONCILE_COOLDOWN_MS = 6 * 3600_000;
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function evaluateAcPowerConfigReconcile(input) {
    const configPowerW = input.configPowerW > 0 ? Math.round(input.configPowerW) : 0;
    const { powerWs } = (0, learned_power_1.collectRecentDayMetrics)(input.consumerStats, input.nowMs, learned_power_1.LEARNED_POWER_LOOKBACK_DAYS);
    const sampleDays = powerWs.length;
    const learned = median(powerWs);
    const learnedPowerW = learned !== null && learned > 0 ? Math.round(learned) : null;
    if (configPowerW <= 0) {
        return {
            shouldWrite: false,
            learnedPowerW,
            configPowerW,
            sampleDays,
            relSpan: null,
            deltaW: null,
            reasonDe: "Keine gültige Config-Leistung.",
        };
    }
    if (sampleDays < exports.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS || learnedPowerW === null) {
        return {
            shouldWrite: false,
            learnedPowerW,
            configPowerW,
            sampleDays,
            relSpan: null,
            deltaW: null,
            reasonDe: `Learning unzureichend (${sampleDays}/${exports.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS} Tage, min ${learned_power_1.LEARNED_POWER_MIN_DAY_RUNTIME_SEC}s/Tag).`,
        };
    }
    const minW = Math.min(...powerWs);
    const maxW = Math.max(...powerWs);
    const relSpan = learnedPowerW > 0 ? (maxW - minW) / learnedPowerW : null;
    if (relSpan === null || relSpan > exports.AC_POWER_RECONCILE_MAX_REL_SPAN) {
        return {
            shouldWrite: false,
            learnedPowerW,
            configPowerW,
            sampleDays,
            relSpan,
            deltaW: learnedPowerW - configPowerW,
            reasonDe: `Learning instabil (rel. Spannweite ${(relSpan ?? 0).toFixed(2)} > ${exports.AC_POWER_RECONCILE_MAX_REL_SPAN}).`,
        };
    }
    const deltaW = learnedPowerW - configPowerW;
    const absDelta = Math.abs(deltaW);
    const relDelta = absDelta / configPowerW;
    if (absDelta < exports.AC_POWER_RECONCILE_MIN_ABS_DELTA_W && relDelta < exports.AC_POWER_RECONCILE_MIN_REL_DELTA) {
        return {
            shouldWrite: false,
            learnedPowerW,
            configPowerW,
            sampleDays,
            relSpan,
            deltaW,
            reasonDe: `Abweichung nicht relevant (Δ ${deltaW} W).`,
        };
    }
    if (learnedPowerW === configPowerW) {
        return {
            shouldWrite: false,
            learnedPowerW,
            configPowerW,
            sampleDays,
            relSpan,
            deltaW: 0,
            reasonDe: "Config entspricht bereits dem gelernten Median.",
        };
    }
    const last = input.lastReconcileMs ?? null;
    if (last !== null && input.nowMs - last < exports.AC_POWER_RECONCILE_COOLDOWN_MS) {
        return {
            shouldWrite: false,
            learnedPowerW,
            configPowerW,
            sampleDays,
            relSpan,
            deltaW,
            reasonDe: "Cooldown aktiv — kein erneuter Config-Write.",
        };
    }
    return {
        shouldWrite: true,
        learnedPowerW,
        configPowerW,
        sampleDays,
        relSpan,
        deltaW,
        reasonDe: `Config ${configPowerW} W → gelernt ${learnedPowerW} W (${sampleDays} stabile Tage).`,
    };
}
exports.evaluateAcPowerConfigReconcile = evaluateAcPowerConfigReconcile;
/** Vorgemerkte Admin-Writes — warten auf Non-Live + Idle. */
const pendingByUnit = new Map();
const lastReconcileByUnit = new Map();
function resetAcPowerReconcileMemoryForTests() {
    pendingByUnit.clear();
    lastReconcileByUnit.clear();
}
exports.resetAcPowerReconcileMemoryForTests = resetAcPowerReconcileMemoryForTests;
function getPendingAcPowerReconcileForTests() {
    return new Map(pendingByUnit);
}
exports.getPendingAcPowerReconcileForTests = getPendingAcPowerReconcileForTests;
/** Merkt Unit vor; schreibt NICHT (kein Restart). */
function queueAcPowerConfigReconcile(input) {
    const prev = lastReconcileByUnit.get(input.unitIndex);
    const decision = evaluateAcPowerConfigReconcile({
        configPowerW: input.configPowerW,
        consumerStats: input.consumerStats,
        nowMs: input.nowMs,
        lastReconcileMs: prev?.ms ?? null,
    });
    if (!decision.shouldWrite || decision.learnedPowerW === null) {
        return { ...decision, queued: false };
    }
    if (prev && prev.powerW === decision.learnedPowerW) {
        return {
            ...decision,
            shouldWrite: false,
            queued: false,
            reasonDe: "Zielwert bereits geschrieben.",
        };
    }
    pendingByUnit.set(input.unitIndex, {
        learnedPowerW: decision.learnedPowerW,
        reasonDe: decision.reasonDe,
    });
    return { ...decision, queued: true };
}
exports.queueAcPowerConfigReconcile = queueAcPowerConfigReconcile;
/**
 * Hartes Flush-Gate für updateConfig-Neustart.
 * Global Live und Restore blockieren immer — auch bei idle AC/Heizstab.
 */
async function isSafeForAcConfigRestart(host) {
    if ((0, barrier_1.isRestoreInProgress)()) {
        return { safe: false, reasonDe: "Restore aktiv — kein Config-Restart." };
    }
    if (typeof host.getStateAsync === "function") {
        const globalSt = await host.getStateAsync(tree_paths_1.GLOBAL.executionMode);
        const globalMode = (0, execution_mode_1.parseMode)(globalSt?.val);
        if (globalMode === "live") {
            return {
                safe: false,
                reasonDe: "Global Live — kein automatischer Config-Restart (Pending bleibt).",
            };
        }
        for (let i = 1; i <= 5; i++) {
            const running = await host.getStateAsync(`addons.air_conditioning.unit_${i}.running`);
            if (running?.val === true) {
                return { safe: false, reasonDe: `AC Unit ${i} läuft — Config-Write zurückgestellt.` };
            }
            const cleaning = await host.getStateAsync(`addons.air_conditioning.unit_${i}.cleaning_active`);
            if (cleaning?.val === true) {
                return { safe: false, reasonDe: `AC Unit ${i} Reinigung — Config-Write zurückgestellt.` };
            }
        }
        const ihStage = await host.getStateAsync("addons.immersion_heater.runtime.commanded_stage");
        const stageN = typeof ihStage?.val === "number" ? ihStage.val : Number(ihStage?.val);
        if (Number.isFinite(stageN) && stageN > 0) {
            return { safe: false, reasonDe: "Heizstab aktiv (Stufe > 0) — Config-Write zurückgestellt." };
        }
    }
    else {
        // Ohne State-API: konservativ kein Flush (außer Tests setzen devicesBusy=false + mock getState).
        return {
            safe: false,
            reasonDe: "Kein getStateAsync — Config-Write nicht möglich zu prüfen.",
        };
    }
    return {
        safe: true,
        reasonDe: "Non-Live + Idle — gebündelter Config-Write erlaubt (Neustart folgt).",
    };
}
exports.isSafeForAcConfigRestart = isSafeForAcConfigRestart;
/**
 * Schreibt alle vorgemerkten ac_u*_estimated_power_w in EINEM updateConfig.
 * Global Live / Restore können nicht per Override umgangen werden.
 */
async function flushQueuedAcPowerConfigReconcile(input) {
    if (pendingByUnit.size === 0) {
        return { wrote: false, deferred: false, reasonDe: "Nichts vorgemerkt.", units: [] };
    }
    if (typeof input.host.updateConfig !== "function") {
        return {
            wrote: false,
            deferred: true,
            reasonDe: "updateConfig nicht verfügbar — Pending bleibt.",
            units: [...pendingByUnit.keys()],
        };
    }
    const gate = await isSafeForAcConfigRestart(input.host);
    let safe = gate.safe;
    let reasonDe = gate.reasonDe;
    if (safe && input.devicesBusy) {
        safe = false;
        reasonDe = "AC-Gerät aktiv im Tick — Config-Write zurückgestellt.";
    }
    if (!safe) {
        input.host.log?.debug?.(`ac power reconcile deferred (${pendingByUnit.size} units): ${reasonDe}`);
        return {
            wrote: false,
            deferred: true,
            reasonDe,
            units: [...pendingByUnit.keys()],
        };
    }
    const base = input.host.config && typeof input.host.config === "object"
        ? { ...input.host.config }
        : {};
    const units = [];
    const reasons = [];
    for (const [unitIndex, pending] of pendingByUnit) {
        const key = `ac_u${unitIndex}_estimated_power_w`;
        if (Number(base[key]) === pending.learnedPowerW) {
            lastReconcileByUnit.set(unitIndex, { ms: input.nowMs, powerW: pending.learnedPowerW });
            continue;
        }
        base[key] = pending.learnedPowerW;
        units.push(unitIndex);
        reasons.push(`u${unitIndex}: ${pending.reasonDe}`);
        lastReconcileByUnit.set(unitIndex, { ms: input.nowMs, powerW: pending.learnedPowerW });
    }
    pendingByUnit.clear();
    if (units.length === 0) {
        return {
            wrote: false,
            deferred: false,
            reasonDe: "Native Config bereits aktuell.",
            units: [],
        };
    }
    await input.host.updateConfig(base);
    if (input.host.config && typeof input.host.config === "object") {
        for (const unitIndex of units) {
            const key = `ac_u${unitIndex}_estimated_power_w`;
            input.host.config[key] = base[key];
        }
    }
    const msg = `ac power reconcile write (restart follows): ${reasons.join("; ")}`;
    input.host.log?.info?.(msg);
    return { wrote: true, deferred: false, reasonDe: msg, units };
}
exports.flushQueuedAcPowerConfigReconcile = flushQueuedAcPowerConfigReconcile;
