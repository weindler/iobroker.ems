"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gridSupplyRevisionPayload = exports.medianPriceCtFromGridSupply = exports.gridSlotsToPrice15Min = exports.buildGridSupplyForecast = exports.classifyGridPriceLabel = exports.resolveFlexibleGridImportAllowed = exports.computeEffectiveMaxGridImportW = void 0;
const config_1 = require("../../global_modes/config");
const quality_1 = require("../quality");
const time_1 = require("../time");
function computeEffectiveMaxGridImportW(maxGridImportW, houseFuseLimitW) {
    const limits = [];
    if (maxGridImportW !== null && Number.isFinite(maxGridImportW) && maxGridImportW > 0) {
        limits.push(maxGridImportW);
    }
    if (houseFuseLimitW !== null && Number.isFinite(houseFuseLimitW) && houseFuseLimitW > 0) {
        limits.push(houseFuseLimitW);
    }
    if (limits.length === 0)
        return null;
    return Math.min(...limits);
}
exports.computeEffectiveMaxGridImportW = computeEffectiveMaxGridImportW;
function resolveFlexibleGridImportAllowed(globalMode, policyGridImportAllowed) {
    const mode = globalMode && (0, config_1.isGlobalMode)(globalMode) ? globalMode : "balanced";
    if (mode === "off") {
        return false;
    }
    if (policyGridImportAllowed === false) {
        return false;
    }
    return true;
}
exports.resolveFlexibleGridImportAllowed = resolveFlexibleGridImportAllowed;
function medianPrice(slots) {
    const prices = slots
        .map((s) => s.priceCtPerKwh)
        .filter((p) => p !== null && Number.isFinite(p));
    if (prices.length === 0)
        return null;
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
}
function classifyGridPriceLabel(priceCtPerKwh, referenceMedianCt) {
    if (priceCtPerKwh === null || !Number.isFinite(priceCtPerKwh))
        return null;
    if (referenceMedianCt === null || !Number.isFinite(referenceMedianCt))
        return "normal";
    if (priceCtPerKwh <= referenceMedianCt * 0.95)
        return "cheap";
    if (priceCtPerKwh >= referenceMedianCt * 1.05)
        return "expensive";
    return "normal";
}
exports.classifyGridPriceLabel = classifyGridPriceLabel;
function normalizeDynamicSlots(rawSlots, flexibleImportAllowed, effectiveMaxImportW, referenceMedianCt) {
    const byStart = new Map();
    for (const raw of rawSlots) {
        if (!Number.isFinite(raw.slotStartMs))
            continue;
        const startIso = (0, time_1.isoFromMs)(raw.slotStartMs);
        const endIso = (0, time_1.isoFromMs)((0, time_1.slotEndMsFromStart)(raw.slotStartMs));
        if (!(0, time_1.isValidIsoTimestamp)(startIso) || !(0, time_1.isValidIsoTimestamp)(endIso))
            continue;
        const priceCtPerKwh = Number.isFinite(raw.priceCtPerKwh) && raw.priceCtPerKwh >= 0 ? raw.priceCtPerKwh : null;
        const slot = {
            startIso,
            endIso,
            priceCtPerKwh,
            importAllowed: flexibleImportAllowed,
            maxImportPowerW: effectiveMaxImportW,
            priceLabel: classifyGridPriceLabel(priceCtPerKwh, referenceMedianCt),
            quality: (0, quality_1.operatorQuality)(priceCtPerKwh === null ? "missing" : "valid", priceCtPerKwh === null ? "Preis für Slot unbekannt" : "Dynamischer Tarif-Slot"),
        };
        const existing = byStart.get(startIso);
        if (!existing) {
            byStart.set(startIso, slot);
            continue;
        }
        if (existing.priceCtPerKwh === null && slot.priceCtPerKwh !== null) {
            byStart.set(startIso, slot);
        }
    }
    return [...byStart.values()].sort((a, b) => a.startIso.localeCompare(b.startIso));
}
function resolveSourceAndCurrentPrice(input) {
    if (input.dynamicSlots.length > 0) {
        const current = input.currentPriceCtPerKwh !== null && Number.isFinite(input.currentPriceCtPerKwh)
            ? input.currentPriceCtPerKwh
            : null;
        return {
            source: "dynamic_tariff",
            currentPriceCtPerKwh: current,
            quality: (0, quality_1.operatorQuality)("valid", "Dynamischer Tarif mit Preis-Slots verfügbar"),
            reasonPart: "Dynamischer Tarif aktiv",
        };
    }
    if (input.fixedPriceCtPerKwh !== null && Number.isFinite(input.fixedPriceCtPerKwh) && input.fixedPriceCtPerKwh >= 0) {
        return {
            source: "fixed_tariff",
            currentPriceCtPerKwh: input.fixedPriceCtPerKwh,
            quality: (0, quality_1.operatorQuality)("degraded", "Festpreis-Fallback — keine dynamischen Slots"),
            reasonPart: "Festpreis-Fallback",
        };
    }
    const current = input.currentPriceCtPerKwh !== null && Number.isFinite(input.currentPriceCtPerKwh)
        ? input.currentPriceCtPerKwh
        : null;
    return {
        source: "none",
        currentPriceCtPerKwh: current,
        quality: (0, quality_1.operatorQuality)("missing", "Keine Preisquelle verfügbar"),
        reasonPart: current !== null ? "Aktueller Preis ohne Slot-Forecast" : "Preisquelle fehlt",
    };
}
function buildGridSupplyForecast(input) {
    const generatedAt = input.now.toISOString();
    const flexibleImportAllowed = resolveFlexibleGridImportAllowed(input.globalMode, input.policyGridImportAllowed);
    const effectiveMaxGridImportW = computeEffectiveMaxGridImportW(input.configuredMaxGridImportW, input.configuredHouseFuseLimitW);
    const { source, currentPriceCtPerKwh, quality: sourceQuality, reasonPart } = resolveSourceAndCurrentPrice(input);
    const normalizedDynamic = normalizeDynamicSlots(input.dynamicSlots, flexibleImportAllowed, effectiveMaxGridImportW, medianPrice(input.dynamicSlots.map((s) => ({
        priceCtPerKwh: Number.isFinite(s.priceCtPerKwh) ? s.priceCtPerKwh : null,
    }))));
    const slots = normalizedDynamic;
    const validUntil = slots.length > 0 ? slots[slots.length - 1].endIso : null;
    let reasonDe = reasonPart;
    if (!flexibleImportAllowed) {
        if (input.globalMode && (0, config_1.isGlobalMode)(input.globalMode) && input.globalMode === "off") {
            reasonDe = "Global Mode off — flexible Netzenergie gesperrt";
        }
        else if (input.policyGridImportAllowed === false) {
            reasonDe = "Netzbezug durch Policy gesperrt";
        }
        else {
            reasonDe = "Flexible Netzenergie nicht erlaubt";
        }
    }
    else if (slots.length > 0) {
        reasonDe = `${reasonPart}; ${slots.length} Preis-Slots (15 min)`;
    }
    let quality = sourceQuality;
    if (!flexibleImportAllowed) {
        quality = (0, quality_1.operatorQuality)("disabled", reasonDe, quality.confidencePct);
    }
    else if (slots.length === 0 && source === "none") {
        quality = (0, quality_1.operatorQuality)("missing", reasonDe);
    }
    else if (slots.some((s) => s.priceCtPerKwh === null)) {
        quality = (0, quality_1.operatorQuality)("degraded", reasonDe);
    }
    return {
        generatedAt,
        validUntil,
        source,
        currentPriceCtPerKwh,
        gridImportAllowed: flexibleImportAllowed,
        configuredMaxGridImportW: input.configuredMaxGridImportW,
        configuredHouseFuseLimitW: input.configuredHouseFuseLimitW,
        effectiveMaxGridImportW,
        slots,
        quality,
        reasonDe,
    };
}
exports.buildGridSupplyForecast = buildGridSupplyForecast;
function gridSlotsToPrice15Min(slots) {
    const out = [];
    for (const slot of slots) {
        if (slot.priceCtPerKwh === null || !Number.isFinite(slot.priceCtPerKwh))
            continue;
        const startMs = Date.parse(slot.startIso);
        if (!Number.isFinite(startMs))
            continue;
        out.push({ slotStartMs: startMs, priceCtPerKwh: slot.priceCtPerKwh });
    }
    return out.sort((a, b) => a.slotStartMs - b.slotStartMs);
}
exports.gridSlotsToPrice15Min = gridSlotsToPrice15Min;
function medianPriceCtFromGridSupply(forecast) {
    return medianPrice(forecast.slots);
}
exports.medianPriceCtFromGridSupply = medianPriceCtFromGridSupply;
function gridSupplyRevisionPayload(forecast) {
    return JSON.stringify({
        source: forecast.source,
        gridImportAllowed: forecast.gridImportAllowed,
        currentPriceCtPerKwh: forecast.currentPriceCtPerKwh,
        effectiveMaxGridImportW: forecast.effectiveMaxGridImportW,
        slots: forecast.slots.map((s) => ({
            startIso: s.startIso,
            endIso: s.endIso,
            priceCtPerKwh: s.priceCtPerKwh,
            importAllowed: s.importAllowed,
        })),
        qualityStatus: forecast.quality.status,
    });
}
exports.gridSupplyRevisionPayload = gridSupplyRevisionPayload;
