"use strict";
/**
 * Unified/Daily-Plan Cadence — wiederverwendet den bestehenden Material-Digest
 * (`aiTriggerDigestPayload`), der bewusst Slot-Rollen und Telemetrie-Rauschen ausblendet.
 *
 * Kein zweiter Scheduler: der ~60-s-Tick prüft nur, ob ein neuer Plan fachlich nötig ist.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.unifiedPlanCadenceDigest = void 0;
const trigger_digest_1 = require("../../../ai/trigger_digest");
function bucket(value, size) {
    if (value === null || value === undefined || !Number.isFinite(value) || size <= 0)
        return null;
    return Math.round(value / size) * size;
}
/**
 * Fingerabdruck für „soll ein neuer Tages-/Unified-Plan erzeugt werden?“.
 * Enthält u. a. lokalen Kalendertag (→ Tageswechsel), PV-/Preis-Buckets,
 * aktive Flex-Familien (Wallbox connected, IH/Klima/Batterie), groben Energiebedarf.
 */
function unifiedPlanCadenceDigest(plan) {
    return JSON.stringify({
        material: (0, trigger_digest_1.aiTriggerDigestPayload)(plan),
        houseLoadEnergyKwhBucket: bucket(plan.totals.fixedHouseLoadEnergyKwh, trigger_digest_1.AI_TRIGGER_ENERGY_BUCKET_KWH),
    });
}
exports.unifiedPlanCadenceDigest = unifiedPlanCadenceDigest;
