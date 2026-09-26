"use strict";
/**
 * Rollender, maschinenlesbarer 72-h-Ausblick aus dem autoritativen Unified Plan.
 *
 * Dieses Modul entscheidet und dispatcht nichts. Es verdichtet ausschließlich den
 * bereits berechneten Planner-Input/-Output für UI, App und Diagnose. Fehlende
 * Eingangswerte bleiben null; partielle Reihen werden nicht zu Vollwerten erklärt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatOperatorOutlook72hDe = exports.buildOperatorOutlook72h = exports.OPERATOR_OUTLOOK_HOURS = exports.OPERATOR_OUTLOOK_72H_DE = exports.OPERATOR_OUTLOOK_72H_JSON = void 0;
const time_1 = require("./time");
exports.OPERATOR_OUTLOOK_72H_JSON = "operator.outlook_72h.json";
exports.OPERATOR_OUTLOOK_72H_DE = "operator.outlook_72h_de";
exports.OPERATOR_OUTLOOK_HOURS = 72;
function round(n, digits = 3) {
    const f = 10 ** digits;
    return Math.round((n + Number.EPSILON) * f) / f;
}
function finiteMs(iso) {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
}
function fullSeriesSum(values) {
    const finite = values.filter((v) => typeof v === "number" && Number.isFinite(v));
    return {
        value: values.length > 0 && finite.length === values.length ? round(finite.reduce((a, b) => a + b, 0)) : null,
        known: finite.length,
    };
}
function priceSummary(values, slotCount) {
    const finite = values.filter((v) => typeof v === "number" && Number.isFinite(v));
    return {
        min: finite.length > 0 ? round(Math.min(...finite), 2) : null,
        max: finite.length > 0 ? round(Math.max(...finite), 2) : null,
        average: finite.length > 0 ? round(finite.reduce((a, b) => a + b, 0) / finite.length, 2) : null,
        knownSlots: finite.length,
        complete: slotCount > 0 && finite.length === slotCount,
    };
}
/** Nur bekannte, zusammenhängende Viertelstunden dürfen ein nutzbares PV-Fenster bilden. */
function pvCoverageWindow(daySlots, pvPower, loadPower) {
    if (daySlots.length < 2)
        return null;
    const covered = [];
    for (const slot of daySlots) {
        const pv = pvPower.get(slot.startIso);
        const load = loadPower.get(slot.startIso);
        if (pv == null || load == null || !Number.isFinite(pv) || !Number.isFinite(load))
            return null;
        covered.push(pv > 0 && pv >= load);
    }
    const runs = [];
    for (let i = 0; i < covered.length;) {
        if (!covered[i]) {
            i++;
            continue;
        }
        const first = i;
        while (i < covered.length && covered[i]) {
            if (i > first && daySlots[i - 1].endIso !== daySlots[i].startIso)
                break;
            i++;
        }
        if (i - first >= 2)
            runs.push({ first, last: i - 1 });
    }
    if (!runs.length)
        return null;
    // Kurze Wolkenlücken bis zu zwei Slots verbinden nur benachbarte stabile Fenster.
    const merged = [runs[0]];
    for (const run of runs.slice(1)) {
        const prev = merged[merged.length - 1];
        const gap = run.first - prev.last - 1;
        let contiguous = gap <= 2;
        for (let i = prev.last; i < run.first; i++) {
            if (daySlots[i].endIso !== daySlots[i + 1].startIso)
                contiguous = false;
        }
        if (contiguous)
            prev.last = run.last;
        else
            merged.push({ ...run });
    }
    return {
        startIso: daySlots[merged[0].first].startIso,
        endIso: daySlots[merged[merged.length - 1].last].endIso,
    };
}
function allocationSummaries(cells) {
    const grouped = new Map();
    for (const cell of cells) {
        if (!Number.isFinite(cell.allocatedEnergyKwh) || cell.allocatedEnergyKwh <= 0)
            continue;
        const key = `${cell.consumerId}\u0000${cell.kind}\u0000${cell.energySource}`;
        const existing = grouped.get(key);
        if (existing) {
            existing.energyKwh = round(existing.energyKwh + cell.allocatedEnergyKwh);
            if (cell.slot.startIso < existing.firstStartIso)
                existing.firstStartIso = cell.slot.startIso;
            if (cell.slot.endIso > existing.lastEndIso)
                existing.lastEndIso = cell.slot.endIso;
            existing.reasonCodes = [...new Set([...existing.reasonCodes, ...cell.reasonCodes])].sort();
        }
        else {
            grouped.set(key, {
                consumerId: cell.consumerId,
                kind: cell.kind,
                energySource: cell.energySource,
                energyKwh: round(cell.allocatedEnergyKwh),
                firstStartIso: cell.slot.startIso,
                lastEndIso: cell.slot.endIso,
                reasonCodes: [...new Set(cell.reasonCodes)].sort(),
            });
        }
    }
    return [...grouped.values()].sort((a, b) => a.firstStartIso.localeCompare(b.firstStartIso) || a.consumerId.localeCompare(b.consumerId));
}
function dayLabelDe(dateKey, todayKey) {
    const [, month, day] = dateKey.split("-");
    const shortDate = day && month ? `${day}.${month}.` : dateKey;
    if (dateKey === todayKey)
        return `Heute (${shortDate})`;
    if (dateKey === (0, time_1.addDaysToDateKey)(todayKey, 1))
        return `Morgen (${shortDate})`;
    if (dateKey === (0, time_1.addDaysToDateKey)(todayKey, 2))
        return `Übermorgen (${shortDate})`;
    const noonUtc = new Date(`${dateKey}T12:00:00.000Z`);
    const weekday = Number.isFinite(noonUtc.getTime())
        ? new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" }).format(noonUtc)
        : "Tag";
    return `${weekday} (${shortDate})`;
}
function decisionAllocation(cells, nowMs) {
    const positive = cells
        .filter((cell) => Number.isFinite(cell.allocatedEnergyKwh) && cell.allocatedEnergyKwh > 0)
        .sort((a, b) => a.slot.startIso.localeCompare(b.slot.startIso));
    return {
        energyKwh: round(positive.reduce((sum, cell) => sum + cell.allocatedEnergyKwh, 0)),
        firstStartIso: positive[0]?.slot.startIso ?? null,
        lastEndIso: positive[positive.length - 1]?.slot.endIso ?? null,
        energySources: [...new Set(positive.map((cell) => cell.energySource))].sort(),
        reasonCodes: [...new Set(positive.flatMap((cell) => cell.reasonCodes))].sort(),
        active: positive.some((cell) => {
            const start = finiteMs(cell.slot.startIso);
            const end = finiteMs(cell.slot.endIso);
            return start !== null && end !== null && start <= nowMs && end > nowMs;
        }),
    };
}
function sourceTextDe(sources) {
    const labels = {
        pv_surplus: "PV-Überschuss",
        grid: "Netzstrom",
        battery: "Batterieenergie",
        mixed: "gemischter Energie",
        none: "nicht zugeordneter Energie",
    };
    if (sources.length === 0)
        return "ohne bekannte Energiequelle";
    return `aus ${sources.map((source) => labels[source]).join(" und ")}`;
}
function localWhenDe(iso, timezone) {
    if (!iso)
        return "einem noch unbekannten Zeitpunkt";
    return (0, time_1.formatLocalDateTimeDe)(iso, timezone) ?? String(iso);
}
function baseDecision(args) {
    return {
        consumerId: args.consumerId,
        kind: args.kind,
        labelDe: args.labelDe,
        state: args.state,
        plannedEnergyKwh: args.allocation.energyKwh,
        firstStartIso: args.allocation.firstStartIso,
        lastEndIso: args.allocation.lastEndIso,
        energySources: args.allocation.energySources,
        reasonCodes: [...new Set([...args.allocation.reasonCodes, ...(args.extraReasonCodes ?? [])])].sort(),
        explanationDe: args.explanationDe,
    };
}
function buildOutlookDecisions(args) {
    const decisions = [];
    const emptyAllocation = decisionAllocation([], args.nowMs);
    const stateForAllocation = (allocation) => allocation.active ? "active" : allocation.firstStartIso ? "scheduled" : "unallocated";
    const batteryAllocation = decisionAllocation(args.allocations.filter((cell) => cell.kind === "battery_charge"), args.nowMs);
    if (batteryAllocation.firstStartIso) {
        const state = stateForAllocation(batteryAllocation);
        const target = args.input.battery.endSocTargetPct ?? args.input.battery.reserveSocPct;
        const targetText = target == null ? "" : ` bis zum Ziel von ${round(target, 1)} %`;
        decisions.push(baseDecision({
            consumerId: "battery",
            kind: "battery_charge",
            labelDe: "Batterie",
            state,
            allocation: batteryAllocation,
            explanationDe: `Batterieladung ${state === "active" ? "läuft" : "ist"}${targetText} mit ${batteryAllocation.energyKwh.toFixed(1).replace(".", ",")} kWh ` +
                `${sourceTextDe(batteryAllocation.energySources)} ${state === "active" ? "eingeplant" : `ab ${localWhenDe(batteryAllocation.firstStartIso, args.timezone)} eingeplant`}.`,
        }));
    }
    else {
        const soc = args.input.battery.socPct;
        const reserve = args.input.battery.reserveSocPct ?? args.input.battery.minSocPct;
        const safelyAboveReserve = soc !== null && reserve !== null && soc >= reserve;
        decisions.push(baseDecision({
            consumerId: "battery",
            kind: "battery_charge",
            labelDe: "Batterie",
            state: safelyAboveReserve || args.input.battery.requiredChargeEnergyKwh === 0 ? "not_needed" : "unallocated",
            allocation: emptyAllocation,
            explanationDe: safelyAboveReserve
                ? `Keine aktive Batterieladung im 72-h-Plan; SOC ${soc.toFixed(0)} % liegt nicht unter der Reserve ${reserve.toFixed(0)} %.`
                : "Keine aktive Batterieladung im 72-h-Plan; Ladebedarf oder Reserve sind nicht vollständig bewertbar.",
        }));
    }
    const thermal = args.input.thermal;
    if (thermal) {
        const thermalCells = args.allocations.filter((cell) => cell.kind === "immersion_heater");
        const thermalAllocation = decisionAllocation(thermalCells, args.nowMs);
        if (thermalAllocation.firstStartIso) {
            const explicitDefer = args.plan.reasonCodes.includes("thermal_opportunity_deferred");
            const firstMs = finiteMs(thermalAllocation.firstStartIso);
            const firstDayKey = (0, time_1.localDateKeyInTimezone)(new Date(thermalAllocation.firstStartIso), args.timezone);
            const todayKey = (0, time_1.localDateKeyInTimezone)(new Date(args.nowMs), args.timezone);
            const emptyAtMs = thermal.estimatedEmptyAtIso ? finiteMs(thermal.estimatedEmptyAtIso) : null;
            const onlySoft = thermalCells.every((cell) => cell.consumerId.includes("soft"));
            const safeFutureSoft = onlySoft &&
                firstDayKey !== todayKey &&
                firstMs !== null &&
                emptyAtMs !== null &&
                emptyAtMs >= firstMs;
            const pvBeforeFirst = args.input.pv.slots
                .filter((slot) => finiteMs(slot.slot.startIso) !== null && Date.parse(slot.slot.startIso) < (firstMs ?? 0))
                .map((slot) => slot.energyKwh)
                .filter((energy) => energy !== null && Number.isFinite(energy));
            const pvOnFirstDay = args.input.pv.slots
                .filter((slot) => (0, time_1.localDateKeyInTimezone)(new Date(slot.slot.startIso), args.timezone) === firstDayKey)
                .map((slot) => slot.energyKwh)
                .filter((energy) => energy !== null && Number.isFinite(energy));
            const strongerPvWindow = pvBeforeFirst.length > 0 &&
                pvOnFirstDay.length > 0 &&
                Math.max(...pvOnFirstDay) > Math.max(...pvBeforeFirst) + 0.05;
            const state = !thermalAllocation.active && (explicitDefer || safeFutureSoft) && firstMs !== null && firstMs > args.nowMs
                ? "deferred"
                : stateForAllocation(thermalAllocation);
            const reach = thermal.estimatedEmptyAtIso
                ? ` Die thermische Reichweite endet voraussichtlich ${localWhenDe(thermal.estimatedEmptyAtIso, args.timezone)}.`
                : "";
            const explanation = state === "deferred"
                ? `Der Heizstab wartet bis ${localWhenDe(thermalAllocation.firstStartIso, args.timezone)}: Der Unified Planner nutzt dort ${strongerPvWindow || explicitDefer ? "das bessere" : "ein späteres geeignetes"} PV-Fenster, ohne die thermische Deadline zu überschreiten.${reach}`
                : `Der Heizstab ${thermalAllocation.active ? "läuft im aktuellen Planfenster" : `ist ab ${localWhenDe(thermalAllocation.firstStartIso, args.timezone)} eingeplant`} (${thermalAllocation.energyKwh.toFixed(1).replace(".", ",")} kWh ${sourceTextDe(thermalAllocation.energySources)}).${reach}`;
            decisions.push(baseDecision({
                consumerId: "immersion_heater",
                kind: "immersion_heater",
                labelDe: "Heizstab / Wärme",
                state,
                allocation: thermalAllocation,
                explanationDe: explanation,
                extraReasonCodes: explicitDefer ? ["thermal_opportunity_deferred"] : [],
            }));
        }
        else {
            const emptyAtMs = thermal.estimatedEmptyAtIso ? finiteMs(thermal.estimatedEmptyAtIso) : null;
            const horizonEndMs = finiteMs(args.horizonEndIso);
            const noDuty = (thermal.headroomEnergyKwh == null || thermal.headroomEnergyKwh <= 0) &&
                (thermal.hygieneMandatoryKwh == null || thermal.hygieneMandatoryKwh <= 0) &&
                thermal.hygieneDue !== true;
            const reachesBeyondHorizon = emptyAtMs !== null && horizonEndMs !== null && emptyAtMs >= horizonEndMs;
            decisions.push(baseDecision({
                consumerId: "immersion_heater",
                kind: "immersion_heater",
                labelDe: "Heizstab / Wärme",
                state: noDuty || reachesBeyondHorizon ? "not_needed" : "unallocated",
                allocation: emptyAllocation,
                explanationDe: reachesBeyondHorizon
                    ? `Keine Heizstab-Laufzeit im 72-h-Plan nötig; die thermische Reichweite reicht voraussichtlich bis ${localWhenDe(thermal.estimatedEmptyAtIso, args.timezone)}.`
                    : noDuty
                        ? "Kein belastbarer Heizstabbedarf im 72-h-Plan."
                        : "Thermischer Bedarf ist vorhanden, aber im verfügbaren autoritativen Plan ist kein sicherer Heizstab-Slot allokiert.",
            }));
        }
    }
    const wallbox = args.input.wallbox;
    if (wallbox) {
        const wallboxAllocation = decisionAllocation(args.allocations.filter((cell) => cell.kind === "wallbox"), args.nowMs);
        const validTargetSocPct = wallbox.targetSocPct !== null && wallbox.targetSocPct > 0 && wallbox.targetSocPct <= 100
            ? wallbox.targetSocPct
            : null;
        const targetReached = wallbox.vehicleSocPct !== null &&
            validTargetSocPct !== null &&
            wallbox.vehicleSocPct >= validTargetSocPct;
        if (wallboxAllocation.firstStartIso) {
            const firstMs = finiteMs(wallboxAllocation.firstStartIso);
            const state = wallboxAllocation.active
                ? "active"
                : wallbox.connectedNow && firstMs !== null && firstMs > args.nowMs + 15 * 60_000
                    ? "deferred"
                    : "scheduled";
            decisions.push(baseDecision({
                consumerId: "wallbox",
                kind: "wallbox",
                labelDe: "Auto / Wallbox",
                state,
                allocation: wallboxAllocation,
                explanationDe: `Die Wallbox ${state === "active" ? "lädt im aktuellen Planfenster" : state === "deferred" ? "wartet auf das ausgewählte Ladefenster" : "ist eingeplant"}: ` +
                    `${wallboxAllocation.energyKwh.toFixed(1).replace(".", ",")} kWh ${sourceTextDe(wallboxAllocation.energySources)}${state === "active" ? "" : ` ab ${localWhenDe(wallboxAllocation.firstStartIso, args.timezone)}`}.`,
            }));
        }
        else {
            const externallyManaged = wallbox.managementMode === "externally_managed";
            const disconnected = wallbox.connectedNow === false;
            const socTargetText = wallbox.vehicleSocPct !== null && validTargetSocPct !== null
                ? ` Fahrzeug-SOC ${wallbox.vehicleSocPct.toFixed(0)} %, Ziel ${validTargetSocPct.toFixed(0)} %.`
                : "";
            decisions.push(baseDecision({
                consumerId: "wallbox",
                kind: "wallbox",
                labelDe: "Auto / Wallbox",
                state: disconnected
                    ? "unallocated"
                    : externallyManaged
                        ? "unallocated"
                        : targetReached || wallbox.requiredEnergyKwh === 0
                            ? "not_needed"
                            : "unallocated",
                allocation: emptyAllocation,
                explanationDe: disconnected
                    ? `Auto nicht angesteckt.${socTargetText} Kein Ladeplan verfügbar.`
                    : externallyManaged
                        ? "Keine EMS-Wallbox-Allokation; der externe Ladeplan bleibt zuständig."
                        : targetReached
                            ? `Keine Wallbox-Ladung nötig; Fahrzeug-SOC ${wallbox.vehicleSocPct.toFixed(0)} % hat das Ziel ${validTargetSocPct.toFixed(0)} % erreicht.`
                            : "Keine Wallbox-Allokation im 72-h-Plan; Bedarf, Anwesenheit oder ausführbare Slots reichen nicht belastbar aus.",
            }));
        }
    }
    for (const unit of args.input.climate?.units ?? []) {
        const climateAllocation = decisionAllocation(args.allocations.filter((cell) => cell.kind === "climate" && cell.consumerId === unit.unitId), args.nowMs);
        if (climateAllocation.firstStartIso) {
            const model = unit.demandModel === "predictive"
                ? "prädiktivem Raum-/Wetter-Learning"
                : unit.demandModel === "bootstrap"
                    ? "Raumzustand und Wetter-Fallback"
                    : "dem verfügbaren Klimabedarfsmodell";
            const crossing = unit.predictedCrossingAtIso
                ? ` vor der erwarteten Schwellenzeit ${localWhenDe(unit.predictedCrossingAtIso, args.timezone)}`
                : "";
            const hardStop = unit.hardStopMs != null
                ? `; Hard-Off ${localWhenDe(unit.hardStopMs, args.timezone)}`
                : "";
            decisions.push(baseDecision({
                consumerId: unit.unitId,
                kind: "climate",
                labelDe: `Klima ${unit.label}`,
                state: stateForAllocation(climateAllocation),
                allocation: climateAllocation,
                explanationDe: `Klima ${unit.label} ${climateAllocation.active ? "läuft im aktuellen Planfenster" : `ist ab ${localWhenDe(climateAllocation.firstStartIso, args.timezone)} eingeplant`} ` +
                    `(${climateAllocation.energyKwh.toFixed(1).replace(".", ",")} kWh ${sourceTextDe(climateAllocation.energySources)}) auf Basis von ${model}${crossing}${hardStop}.`,
            }));
        }
        else {
            const noNeed = !unit.mandatoryComfort && (unit.expectedEnergyKwh == null || unit.expectedEnergyKwh <= 0);
            decisions.push(baseDecision({
                consumerId: unit.unitId,
                kind: "climate",
                labelDe: `Klima ${unit.label}`,
                state: noNeed ? "not_needed" : "unallocated",
                allocation: emptyAllocation,
                explanationDe: noNeed
                    ? `Klima ${unit.label}: kein belastbarer Kühl-, Heiz- oder Entfeuchtungsbedarf im 72-h-Plan.`
                    : `Klima ${unit.label}: Bedarf erkannt, aber kein sicherer Slot im autoritativen 72-h-Plan.`,
            }));
        }
    }
    for (const other of args.input.otherFlex) {
        const allocation = decisionAllocation(args.allocations.filter((cell) => cell.consumerId === other.consumerId), args.nowMs);
        if (!allocation.firstStartIso && !(other.requiredEnergyKwh && other.requiredEnergyKwh > 0))
            continue;
        decisions.push(baseDecision({
            consumerId: other.consumerId,
            kind: other.kind,
            labelDe: other.label,
            state: stateForAllocation(allocation),
            allocation,
            explanationDe: allocation.firstStartIso
                ? `${other.label} ist mit ${allocation.energyKwh.toFixed(1).replace(".", ",")} kWh ${sourceTextDe(allocation.energySources)} ab ${localWhenDe(allocation.firstStartIso, args.timezone)} eingeplant.`
                : `${other.label}: Bedarf vorhanden, aber kein ausführbarer Slot im 72-h-Plan.`,
        }));
    }
    const stateOrder = {
        active: 0,
        deferred: 1,
        scheduled: 2,
        unallocated: 3,
        not_needed: 4,
    };
    return decisions.sort((a, b) => stateOrder[a.state] - stateOrder[b.state] || a.labelDe.localeCompare(b.labelDe, "de"));
}
function buildOperatorOutlook72h(args) {
    const nowMs = args.now.getTime();
    const requestedEndMs = nowMs + exports.OPERATOR_OUTLOOK_HOURS * 3_600_000;
    const unavailable = (reasonCode) => ({
        schemaVersion: 1,
        generatedAtIso: args.now.toISOString(),
        timezone: args.timezone,
        planId: args.plan?.planId ?? null,
        planGeneration: args.plan?.generation ?? null,
        requestedHours: exports.OPERATOR_OUTLOOK_HOURS,
        horizonStartIso: args.now.toISOString(),
        horizonEndIso: args.now.toISOString(),
        coveredHours: 0,
        coverageHours: { timeline: 0, pv: 0, houseLoad: 0, price: 0 },
        complete: false,
        status: "unavailable",
        confidence: args.plan?.confidence ?? null,
        days: [],
        decisions: [],
        reasonCodes: [reasonCode],
    });
    if (!args.plan || !args.plannerInput)
        return unavailable("unified_plan_unavailable");
    const inputEndMs = finiteMs(args.plannerInput.time.horizonEndIso);
    const planEndMs = finiteMs(args.plan.horizonEndIso);
    const availableEndMs = Math.min(requestedEndMs, inputEndMs ?? requestedEndMs, planEndMs ?? requestedEndMs);
    if (!Number.isFinite(nowMs) || availableEndMs <= nowMs)
        return unavailable("forecast_horizon_elapsed");
    const inWindow = (startIso, endIso) => {
        const start = finiteMs(startIso);
        const end = finiteMs(endIso);
        return start !== null && end !== null && end > nowMs && start < availableEndMs;
    };
    const slots = args.plannerInput.time.slots
        .filter((slot) => inWindow(slot.startIso, slot.endIso))
        .sort((a, b) => a.startIso.localeCompare(b.startIso));
    if (slots.length === 0)
        return unavailable("forecast_slots_unavailable");
    const actualStartMs = Math.max(nowMs, finiteMs(slots[0].startIso) ?? nowMs);
    const actualEndMs = Math.min(availableEndMs, finiteMs(slots[slots.length - 1].endIso) ?? availableEndMs);
    /* Echte Slot-Abdeckung summieren; eine Lücke darf nicht wie ein voller Horizont wirken. */
    const coveredMs = slots.reduce((sum, slot) => {
        const start = finiteMs(slot.startIso);
        const end = finiteMs(slot.endIso);
        if (start === null || end === null)
            return sum;
        return sum + Math.max(0, Math.min(end, requestedEndMs) - Math.max(start, nowMs));
    }, 0);
    const coveredHours = coveredMs / 3_600_000;
    const horizonComplete = coveredHours >= exports.OPERATOR_OUTLOOK_HOURS - 0.001;
    const pvByStart = new Map(args.plannerInput.pv.slots.map((s) => [s.slot.startIso, s.energyKwh]));
    const loadByStart = new Map(args.plannerInput.houseLoad.slots.map((s) => [s.slot.startIso, s.energyKwh]));
    const pvPowerByStart = new Map(args.plannerInput.pv.slots.map((s) => [s.slot.startIso, s.forecastPowerW]));
    const loadPowerByStart = new Map(args.plannerInput.houseLoad.slots.map((s) => [s.slot.startIso, s.forecastPowerW]));
    const batteryByStart = new Map(args.plan.batteryTrajectory.map((p) => [p.slotStartIso, p.socPct]));
    const batteryByEnd = new Map(args.plannerInput.time.slots.map((s) => [s.endIso, batteryByStart.get(s.startIso) ?? null]));
    const priceByStart = new Map(args.plannerInput.prices.slots.map((s) => [s.slot.startIso, s.importCtPerKwh]));
    const knownHours = (values) => round(slots.reduce((sum, slot) => {
        const value = values.get(slot.startIso);
        if (typeof value !== "number" || !Number.isFinite(value))
            return sum;
        const start = finiteMs(slot.startIso);
        const end = finiteMs(slot.endIso);
        return start === null || end === null ? sum : sum + Math.max(0, Math.min(end, requestedEndMs) - Math.max(start, nowMs));
    }, 0) / 3_600_000, 2);
    const coverageHours = {
        timeline: round(coveredHours, 2),
        pv: knownHours(pvByStart),
        houseLoad: knownHours(loadByStart),
        price: knownHours(priceByStart),
    };
    const allocationsInWindow = args.plan.allocations.filter((allocation) => inWindow(allocation.slot.startIso, allocation.slot.endIso));
    const todayKey = (0, time_1.localDateKeyInTimezone)(args.now, args.timezone);
    const daysByKey = new Map();
    for (const slot of slots) {
        const dateKey = (0, time_1.localDateKeyInTimezone)(new Date(slot.startIso), args.timezone);
        const day = daysByKey.get(dateKey) ?? [];
        day.push(slot);
        daysByKey.set(dateKey, day);
    }
    const days = [];
    for (const [dateKey, daySlots] of daysByKey) {
        const dayStartKeys = new Set(daySlots.map((s) => s.startIso));
        const pv = fullSeriesSum(daySlots.map((s) => pvByStart.get(s.startIso)));
        const load = fullSeriesSum(daySlots.map((s) => loadByStart.get(s.startIso)));
        const prices = priceSummary(daySlots.map((s) => priceByStart.get(s.startIso)), daySlots.length);
        const allocations = allocationSummaries(allocationsInWindow.filter((allocation) => dayStartKeys.has(allocation.slot.startIso)));
        const dayBatteryTrajectory = args.plan.batteryTrajectory
            .filter((point) => dayStartKeys.has(point.slotStartIso));
        const batteryPoints = dayBatteryTrajectory
            .map((point) => point.socPct)
            .filter((soc) => typeof soc === "number" && Number.isFinite(soc));
        const pvWindow = pvCoverageWindow(daySlots, pvPowerByStart, loadPowerByStart);
        const before = pvWindow?.startIso === args.plannerInput.time.slots[0]?.startIso
            ? args.plannerInput.battery.socPct
            : pvWindow ? batteryByEnd.get(pvWindow.startIso) ?? null : null;
        const atEnd = pvWindow ? batteryByEnd.get(pvWindow.endIso) ?? null : null;
        const lastEndMs = finiteMs(daySlots[daySlots.length - 1].endIso);
        const midnight = lastEndMs !== null &&
            (0, time_1.localDateKeyInTimezone)(new Date(lastEndMs), args.timezone) !== dateKey
            ? batteryByStart.get(daySlots[daySlots.length - 1].startIso) ?? null
            : null;
        const reasonCodes = [
            ...new Set(allocations.flatMap((allocation) => allocation.reasonCodes)),
        ].sort();
        days.push({
            dateKey,
            dayLabelDe: dayLabelDe(dateKey, todayKey),
            fromIso: daySlots[0].startIso,
            toIso: daySlots[daySlots.length - 1].endIso,
            slotCount: daySlots.length,
            expectedPvKwh: pv.value,
            pvKnownSlots: pv.known,
            expectedHouseLoadKwh: load.value,
            houseLoadKnownSlots: load.known,
            priceCtPerKwh: prices,
            allocations,
            battery: batteryPoints.length > 0
                ? {
                    projectedFirstSocPct: round(batteryPoints[0], 1),
                    projectedLastSocPct: round(batteryPoints[batteryPoints.length - 1], 1),
                    projectedMinSocPct: round(Math.min(...batteryPoints), 1),
                    projectedMaxSocPct: round(Math.max(...batteryPoints), 1),
                    pvStartIso: pvWindow?.startIso ?? null,
                    pvCoverageKnown: daySlots.every((s) => {
                        const p = pvPowerByStart.get(s.startIso);
                        const h = loadPowerByStart.get(s.startIso);
                        return p != null && h != null && Number.isFinite(p) && Number.isFinite(h);
                    }),
                    socBeforePvPct: before == null ? null : round(before, 1),
                    pvEndIso: pvWindow?.endIso ?? null,
                    socAtPvEndPct: atEnd == null ? null : round(atEnd, 1),
                    midnightSocPct: midnight == null ? null : round(midnight, 1),
                    currentSocPct: dateKey === todayKey ? args.plannerInput.battery.socPct : null,
                    chargedEnergyKwh: round(dayBatteryTrajectory.reduce((sum, point) => sum + point.chargeEnergyKwh, 0)),
                    dischargedEnergyKwh: round(dayBatteryTrajectory.reduce((sum, point) => sum + point.dischargeEnergyKwh, 0)),
                    knownPoints: batteryPoints.length,
                }
                : null,
            reasonCodes,
        });
    }
    const reasonCodes = [...new Set(args.plan.reasonCodes)];
    if (!horizonComplete)
        reasonCodes.push("forecast_horizon_shorter_than_72h");
    const valuesIncomplete = days.some((day) => day.expectedPvKwh === null ||
        day.expectedHouseLoadKwh === null ||
        !day.priceCtPerKwh.complete);
    if (valuesIncomplete) {
        reasonCodes.push("forecast_values_incomplete");
    }
    const complete = horizonComplete && !valuesIncomplete;
    const horizonEndIso = new Date(actualEndMs).toISOString();
    const decisions = buildOutlookDecisions({
        nowMs,
        timezone: args.timezone,
        horizonEndIso,
        plan: args.plan,
        input: args.plannerInput,
        allocations: allocationsInWindow,
    });
    return {
        schemaVersion: 1,
        generatedAtIso: args.now.toISOString(),
        timezone: args.timezone,
        planId: args.plan.planId,
        planGeneration: args.plan.generation,
        requestedHours: exports.OPERATOR_OUTLOOK_HOURS,
        horizonStartIso: new Date(actualStartMs).toISOString(),
        horizonEndIso,
        coveredHours: round(coveredHours, 2),
        coverageHours,
        complete,
        status: complete ? "ready" : "partial",
        confidence: args.plan.confidence,
        days,
        decisions,
        reasonCodes: [...new Set(reasonCodes)].sort(),
    };
}
exports.buildOperatorOutlook72h = buildOperatorOutlook72h;
function kwh(value) {
    return value === null ? "unbekannt" : `${value.toFixed(1).replace(".", ",")} kWh`;
}
function allocationLabel(kind) {
    switch (kind) {
        case "battery_charge": return "Batterie laden";
        case "battery_discharge": return "Batterie entladen";
        case "immersion_heater": return "Heizstab";
        case "wallbox": return "Wallbox";
        case "climate": return "Klima";
        default: return "Flexverbrauch";
    }
}
function formatOperatorOutlook72hDe(outlook) {
    if (outlook.status === "unavailable")
        return "72-h-Ausblick nicht verfügbar.";
    const coverage = outlook.coverageHours;
    const header = `Rollender 72-h-Ausblick: Zeitachse ${coverage.timeline.toFixed(1).replace(".", ",")} h, PV ${coverage.pv.toFixed(1).replace(".", ",")} h, Hausverbrauch ${coverage.houseLoad.toFixed(1).replace(".", ",")} h, Preise ${coverage.price.toFixed(1).replace(".", ",")} h.`;
    const lines = outlook.days.map((day) => {
        const price = day.priceCtPerKwh.min === null || day.priceCtPerKwh.max === null
            ? "Preis unbekannt"
            : `Preis ${day.priceCtPerKwh.min.toFixed(1).replace(".", ",")}–${day.priceCtPerKwh.max.toFixed(1).replace(".", ",")} ct/kWh${day.priceCtPerKwh.complete ? "" : " (teilweise)"}`;
        const flex = day.allocations.length
            ? day.allocations.map((a) => `${allocationLabel(a.kind)} ${kwh(a.energyKwh)}`).join(", ")
            : "keine verschiebbare Geräteaktion eingeplant";
        const battery = day.battery
            ? [
                day.battery.currentSocPct != null ? `${day.battery.currentSocPct.toFixed(0)} % ab jetzt` : null,
                day.battery.pvStartIso && day.battery.socBeforePvPct != null
                    ? `${day.battery.socBeforePvPct.toFixed(0)} % vor PV-Beginn (${localWhenDe(day.battery.pvStartIso, outlook.timezone)})` : null,
                day.battery.pvEndIso && day.battery.socAtPvEndPct != null
                    ? `${day.battery.socAtPvEndPct.toFixed(0)} % bei PV-Ende (${localWhenDe(day.battery.pvEndIso, outlook.timezone)})` : null,
                !day.battery.pvStartIso && day.battery.pvCoverageKnown ? "kein ausreichendes PV-Deckungsfenster erwartet" : null,
                !day.battery.pvCoverageKnown ? "PV-/Hausprognose teilweise unbekannt" : null,
                day.battery.midnightSocPct != null ? `${day.battery.midnightSocPct.toFixed(0)} % um Mitternacht` : null,
                day.battery.projectedMinSocPct != null ? `Tiefststand ${day.battery.projectedMinSocPct.toFixed(0)} %` : null,
            ].filter(Boolean).join(" · ")
            : "Batterieprognose unbekannt";
        return `${day.dayLabelDe}: PV ${kwh(day.expectedPvKwh)}, Haus ${kwh(day.expectedHouseLoadKwh)}, ${price}; ${flex}; Batterie ${battery}.`;
    });
    const decisionLines = outlook.decisions.map((decision) => decision.explanationDe);
    return [header, ...lines, ...(decisionLines.length ? ["Planner-Entscheidungen:", ...decisionLines] : [])].join("\n");
}
exports.formatOperatorOutlook72hDe = formatOperatorOutlook72hDe;
