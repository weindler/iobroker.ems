"use strict";
/**
 * Domain-Validity-Maske: 2 Bit je Domäne.
 * 0 = ok, 1 = partial, 2 = missing, 3 = n/a
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.worstDomainQuality = exports.encodeQualityMask = exports.decodeDomainQuality = exports.encodeDomainQuality = exports.TELEMETRY_DOMAIN_COUNT = exports.DOMAIN_QUALITY = exports.TELEMETRY_DOMAIN = void 0;
exports.TELEMETRY_DOMAIN = {
    PV: 0,
    HOUSE: 1,
    GRID: 2,
    BATTERY: 3,
    PRICE: 4,
    EV: 5,
    THERMAL: 6,
    CLIMATE: 7,
    MEASURED_CONSUMERS: 8,
    PLANNER: 9,
};
exports.DOMAIN_QUALITY = {
    ok: 0,
    partial: 1,
    missing: 2,
    na: 3,
};
exports.TELEMETRY_DOMAIN_COUNT = 10;
function encodeDomainQuality(mask, domain, quality) {
    const shift = domain * 2;
    const cleared = mask & ~(0b11 << shift);
    return cleared | ((quality & 0b11) << shift);
}
exports.encodeDomainQuality = encodeDomainQuality;
function decodeDomainQuality(mask, domain) {
    const shift = domain * 2;
    return ((mask >> shift) & 0b11);
}
exports.decodeDomainQuality = decodeDomainQuality;
/** Setzt mehrere Domänen in einer Maske. */
function encodeQualityMask(parts) {
    let mask = 0;
    for (const [key, q] of Object.entries(parts)) {
        const domain = exports.TELEMETRY_DOMAIN[key];
        if (domain === undefined || q === undefined)
            continue;
        mask = encodeDomainQuality(mask, domain, q);
    }
    return mask;
}
exports.encodeQualityMask = encodeQualityMask;
function worstDomainQuality(mask) {
    let worst = exports.DOMAIN_QUALITY.ok;
    for (let d = 0; d < exports.TELEMETRY_DOMAIN_COUNT; d++) {
        const q = decodeDomainQuality(mask, d);
        if (q === exports.DOMAIN_QUALITY.na)
            continue;
        if (q > worst)
            worst = q;
    }
    return worst;
}
exports.worstDomainQuality = worstDomainQuality;
