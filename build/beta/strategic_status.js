"use strict";
/**
 * Strategischer Planstatus Batterie/Wallbox — Planner-/Operator-Semantik.
 * Keine Hardware-Writes, keine Fake-Leistungs-Allocations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAddonStrategicPlanSnapshot = exports.deriveWallboxStrategicStatus = exports.deriveBatteryStrategicStatus = void 0;
const ON_W = 50;
const FULL_SOC_PCT = 99;
function hasAlloc(cells, kind, nowMs, opts) {
    for (const c of cells) {
        if (c.kind !== kind)
            continue;
        if (!(c.allocatedPowerW >= ON_W || c.allocatedEnergyKwh > 0.02))
            continue;
        const a = Date.parse(c.slot.startIso);
        const b = Date.parse(c.slot.endIso);
        if (!Number.isFinite(a) || !Number.isFinite(b))
            continue;
        const current = nowMs >= a && nowMs < b;
        const futureOnly = a > nowMs;
        if (opts?.currentOnly) {
            if (current)
                return true;
            continue;
        }
        if (opts?.futureOnly) {
            if (futureOnly)
                return true;
            continue;
        }
        if (current || futureOnly || b > nowMs)
            return true;
    }
    return false;
}
function batteryLabelDe(s) {
    switch (s) {
        case "charge":
            return "Laden geplant";
        case "hold":
            return "Hold";
        case "reserve_protected":
            return "Reserve geschützt";
        case "available_for_discharge":
            return "Entladung verfügbar";
        default:
            return "Kein Ladebedarf";
    }
}
function wallboxLabelDe(s) {
    switch (s) {
        case "waiting_for_vehicle":
            return "Wartet auf Fahrzeug";
        case "waiting_for_goal":
            return "Wartet auf Ladeziel";
        case "scheduled":
            return "Ladung geplant";
        case "charging":
            return "Ladung aktiv (Plan)";
        case "goal_satisfied":
            return "Ziel erreicht";
        default:
            return "Kein Ladebedarf";
    }
}
/**
 * Strategischer Batteriestatus aus Unified-Plan + Input — keine Writes.
 */
function deriveBatteryStrategicStatus(input) {
    const { plan, nowMs } = input;
    const soc = input.socPct;
    const maxSoc = input.maxSocPct ?? 100;
    const minSoc = input.minSocPct ?? 0;
    const night = input.nightReserveKwh;
    const hasCharge = hasAlloc(plan.allocations, "battery_charge", nowMs) ||
        hasAlloc(plan.allocations, "battery_charge", nowMs, { currentOnly: true }) ||
        hasAlloc(plan.allocations, "battery_charge", nowMs, { futureOnly: true });
    const nightInPlan = plan.reasonCodes.includes("battery_night_reserve") ||
        plan.constraints.some((c) => c.id === "battery.night_reserve") ||
        (night != null && night > 0);
    const reserveProtectedCode = plan.reasonCodes.includes("battery_reserve_protected");
    const full = soc != null && (soc >= FULL_SOC_PCT || soc >= maxSoc - 0.5);
    const atOrAboveReserve = soc != null &&
        input.usableCapacityKwh != null &&
        input.usableCapacityKwh > 0 &&
        night != null &&
        night > 0
        ? (soc / 100) * input.usableCapacityKwh + 1e-6 >= night
        : soc != null && soc > minSoc + 5;
    let status;
    let reasonDe;
    if (hasCharge) {
        status = "charge";
        reasonDe = "Unified plant Batterie-Ladung in einem oder mehreren Fenstern.";
    }
    else if (input.batteryHold) {
        status = "hold";
        reasonDe = "Batterie bewusst auf Hold (z. B. Wallbox-/Fahrzeugladung priorisiert).";
    }
    else if ((nightInPlan || reserveProtectedCode) && (full || atOrAboveReserve)) {
        status = "reserve_protected";
        reasonDe = full
            ? "Batterie voll — keine Ladung; Nachtreserve/Reserve im Plan geschützt."
            : "Nachtreserve im Plan aktiv — SOC geschützt, keine zusätzliche Ladung nötig.";
    }
    else if (full) {
        status = "hold";
        reasonDe = "Batterie voll — keine Ladeallocation; Halt bis Bedarf/PV-Defizit.";
    }
    else if (atOrAboveReserve && !hasCharge) {
        status = "available_for_discharge";
        reasonDe = input.dischargeLiveSupported
            ? "Kein Ladebedarf — Batterie kann Defizite decken (Discharge laut Capability)."
            : "Kein Ladebedarf — Rolle Entladung/Defizitdeckung im Plan; Live-Discharge unverändert unsupported.";
    }
    else {
        status = "idle_no_need";
        reasonDe = "Kein strategischer Batterie-Ladebedarf im aktuellen Plan.";
    }
    const labelDe = batteryLabelDe(status);
    const socTxt = soc != null ? `SOC ${Math.round(soc)} %` : "SOC unbekannt";
    const nightTxt = night != null && night > 0 ? ` · Nachtreserve ~${night.toFixed(1).replace(".", ",")} kWh` : "";
    const summaryDe = status === "charge"
        ? `${labelDe} · ${socTxt}`
        : status === "reserve_protected"
            ? `${labelDe} · ${socTxt}${nightTxt}`
            : status === "hold"
                ? `${labelDe} · ${socTxt} · aktuell keine Ladeaktion`
                : status === "available_for_discharge"
                    ? `${labelDe} · ${socTxt}`
                    : `${labelDe} · ${socTxt}`;
    return {
        status,
        labelDe,
        reasonDe,
        summaryDe,
        hasChargeAllocation: hasCharge,
        socPct: soc,
        nightReserveKwh: night,
    };
}
exports.deriveBatteryStrategicStatus = deriveBatteryStrategicStatus;
/**
 * Strategischer Wallbox-Status — keine erfundenen Ladeallocations.
 */
function deriveWallboxStrategicStatus(input) {
    const { plan, nowMs } = input;
    const current = hasAlloc(plan.allocations, "wallbox", nowMs, { currentOnly: true });
    const future = hasAlloc(plan.allocations, "wallbox", nowMs, { futureOnly: true });
    const any = hasAlloc(plan.allocations, "wallbox", nowMs);
    const goal = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
    const connected = input.connectedNow;
    const need = input.requiredEnergyKwh != null && input.requiredEnergyKwh > 0.05
        ? input.requiredEnergyKwh
        : plan.vehicleChargeEconomics?.requiredEnergyKwh != null &&
            plan.vehicleChargeEconomics.requiredEnergyKwh > 0.05
            ? plan.vehicleChargeEconomics.requiredEnergyKwh
            : null;
    const deadline = input.deadlineIso ?? plan.vehicleChargeEconomics?.deadlineIso ?? null;
    let status;
    let reasonDe;
    if (current) {
        status = "charging";
        reasonDe = "Unified alloziert aktuell Fahrzeugladung.";
    }
    else if (goal?.met === true && !any) {
        status = "goal_satisfied";
        reasonDe = goal.detailDe || "Fahrzeug-Ladeziel im Plan erreicht.";
    }
    else if (future || any) {
        status = "scheduled";
        reasonDe = deadline
            ? `Fahrzeugladung in PV-/Preisfenster geplant (Ziel/Deadline berücksichtigt).`
            : "Fahrzeugladung in späteren Fenstern geplant.";
    }
    else if (connected === false && !input.hasHardFuturePresence) {
        status = "waiting_for_vehicle";
        reasonDe = "Kein Fahrzeug verbunden — kein Ladeplan erforderlich.";
    }
    else if (connected === true && need == null && !deadline) {
        status = "waiting_for_goal";
        reasonDe = "Fahrzeug da, aber kein belastbares Ladeziel/Deadline.";
    }
    else if (connected !== true && input.hasHardFuturePresence && !any) {
        status = "waiting_for_vehicle";
        reasonDe = "Fahrzeug erwartet (Presence) — Ladung noch nicht allokiert.";
    }
    else if (need == null && !any) {
        status = "idle_no_need";
        reasonDe = "Kein Wallbox-Ladebedarf im aktuellen Plan.";
    }
    else {
        status = "waiting_for_goal";
        reasonDe = "Ladeziel/Presence unvollständig — keine Allocation.";
    }
    const labelDe = wallboxLabelDe(status);
    const summaryDe = status === "waiting_for_vehicle"
        ? `${labelDe} · kein Ladeplan erforderlich`
        : status === "scheduled"
            ? `${labelDe}${deadline ? " · Ziel/Deadline gesetzt" : ""}`
            : status === "charging"
                ? `${labelDe}`
                : status === "goal_satisfied"
                    ? `${labelDe}`
                    : status === "waiting_for_goal"
                        ? `${labelDe}`
                        : labelDe;
    return {
        status,
        labelDe,
        reasonDe,
        summaryDe,
        hasChargeAllocation: any,
        connectedNow: connected,
        deadlineIso: deadline,
    };
}
exports.deriveWallboxStrategicStatus = deriveWallboxStrategicStatus;
/** Komplettsnapshot für States/VIS. */
function buildAddonStrategicPlanSnapshot(input) {
    const bat = input.plannerInput.battery;
    const wb = input.plannerInput.wallbox;
    /** Gleiche Hold-Semantik wie Score-Allocator: nur expliziter Hold bei verbundenem Fahrzeug. */
    const batteryHold = wb?.connectedNow === true && wb?.batteryHoldRequested === true;
    const hasHardFuture = (wb?.presenceWindows ?? []).some((w) => (w.status === "available" || w.available === true) &&
        (w.hard === true || w.source === "explicit" || w.source === "live_connected") &&
        Date.parse(w.endIso) > input.nowMs);
    return {
        schemaVersion: 1,
        generatedAtIso: input.generatedAtIso ?? new Date(input.nowMs).toISOString(),
        battery: deriveBatteryStrategicStatus({
            plan: input.plan,
            socPct: bat.socPct,
            minSocPct: bat.minSocPct,
            maxSocPct: bat.maxSocPct,
            nightReserveKwh: bat.nightReserveKwh,
            usableCapacityKwh: bat.usableCapacityKwh,
            batteryHold,
            dischargeLiveSupported: bat.dischargeLiveSupported,
            nowMs: input.nowMs,
        }),
        wallbox: deriveWallboxStrategicStatus({
            plan: input.plan,
            connectedNow: wb ? wb.connectedNow : null,
            requiredEnergyKwh: wb?.requiredEnergyKwh ?? null,
            deadlineIso: wb?.deadlineIso ?? null,
            hasHardFuturePresence: hasHardFuture,
            nowMs: input.nowMs,
        }),
    };
}
exports.buildAddonStrategicPlanSnapshot = buildAddonStrategicPlanSnapshot;
