"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_COMPARE_TARIFF_AUTO = exports.COMPARE_TARIFF_MAX_AGE_MS = exports.COMPARE_TARIFF_RETRY_MS = exports.COMPARE_TARIFF_REFETCH_MS = exports.VERIVOX_REFERENCE_KWH_PER_YEAR = exports.VERIVOX_PRICE_URL = void 0;
exports.parseVerivoxAveragePrice = parseVerivoxAveragePrice;
exports.workPriceFromBrutto = workPriceFromBrutto;
exports.shouldRefetch = shouldRefetch;
exports.isAutoValueFresh = isAutoValueFresh;
exports.parseCompareTariffAuto = parseCompareTariffAuto;
exports.fetchCompareTariff = fetchCompareTariff;
/**
 * Vergleichstarif automatisch aktualisieren (optional, 1× pro Woche).
 *
 * Quelle: öffentliche Verivox-Seite „Strompreisentwicklung“ mit dem Neukunden-Durchschnitt
 * („rund 35 Cent pro Kilowattstunde brutto“, 4.000 kWh/Jahr, Arbeits- plus Grundpreis).
 * Es gibt keine offizielle Schnittstelle; schlägt das Lesen fehl, gilt der manuell eingetragene Preis.
 */
const https = __importStar(require("node:https"));
exports.VERIVOX_PRICE_URL = "https://www.verivox.de/strom/strompreisentwicklung/";
exports.VERIVOX_REFERENCE_KWH_PER_YEAR = 4000;
exports.COMPARE_TARIFF_REFETCH_MS = 7 * 24 * 3600 * 1000;
exports.COMPARE_TARIFF_RETRY_MS = 6 * 3600 * 1000;
/** Älter als das gilt der automatische Wert nicht mehr (Fallback manuell). */
exports.COMPARE_TARIFF_MAX_AGE_MS = 21 * 24 * 3600 * 1000;
const MAX_BYTES = 3 * 1024 * 1024;
exports.EMPTY_COMPARE_TARIFF_AUTO = {
    fetchedAt: null,
    attemptedAt: null,
    bruttoCtPerKwh: null,
    workCtPerKwh: null,
    status: "none",
    errorDe: null,
};
/** „rund 35 Cent pro Kilowattstunde (kWh) brutto“ → 35. Null, wenn nicht plausibel (15–120 ct). */
function parseVerivoxAveragePrice(html) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|\s+/g, " ");
    const m = /(?:rund|ca\.?|circa)\s+(\d{1,3}(?:[.,]\d{1,2})?)\s*Cent\s+pro\s+Kilowattstunde/i.exec(text);
    if (!m)
        return null;
    const v = Number(m[1].replace(",", "."));
    return Number.isFinite(v) && v >= 15 && v <= 120 ? v : null;
}
/** Grundpreis (€/Monat) anteilig herausrechnen: der Verivox-Wert enthält ihn bei 4.000 kWh/Jahr. */
function workPriceFromBrutto(bruttoCt, monthlyBaseEur) {
    const baseCt = (Math.max(0, monthlyBaseEur) * 12 * 100) / exports.VERIVOX_REFERENCE_KWH_PER_YEAR;
    return Math.max(0, Math.round((bruttoCt - baseCt) * 100) / 100);
}
function shouldRefetch(auto, nowMs) {
    const lastOk = auto.fetchedAt ? Date.parse(auto.fetchedAt) : NaN;
    const lastTry = auto.attemptedAt ? Date.parse(auto.attemptedAt) : NaN;
    if (Number.isFinite(lastTry) && nowMs - lastTry < exports.COMPARE_TARIFF_RETRY_MS)
        return false;
    if (Number.isFinite(lastOk) && nowMs - lastOk < exports.COMPARE_TARIFF_REFETCH_MS)
        return false;
    return true;
}
function isAutoValueFresh(auto, nowMs) {
    if (auto.status !== "ok" || auto.workCtPerKwh === null || !auto.fetchedAt)
        return false;
    const t = Date.parse(auto.fetchedAt);
    return Number.isFinite(t) && nowMs - t <= exports.COMPARE_TARIFF_MAX_AGE_MS;
}
function parseCompareTariffAuto(raw) {
    try {
        const o = typeof raw === "string" ? JSON.parse(raw) : null;
        if (!o || typeof o !== "object")
            return { ...exports.EMPTY_COMPARE_TARIFF_AUTO };
        const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
        const str = (v) => (typeof v === "string" && v ? v : null);
        const r = o;
        return {
            fetchedAt: str(r.fetchedAt),
            attemptedAt: str(r.attemptedAt),
            bruttoCtPerKwh: num(r.bruttoCtPerKwh),
            workCtPerKwh: num(r.workCtPerKwh),
            status: r.status === "ok" || r.status === "error" ? r.status : "none",
            errorDe: str(r.errorDe),
        };
    }
    catch {
        return { ...exports.EMPTY_COMPARE_TARIFF_AUTO };
    }
}
function httpGetText(url, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { "User-Agent": "iobroker.ems (Preisvergleich, 1x pro Woche)", Accept: "text/html" }, timeout: timeoutMs }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const chunks = [];
            let size = 0;
            res.on("data", (c) => {
                size += c.length;
                if (size > MAX_BYTES) {
                    req.destroy(new Error("Antwort zu groß"));
                    return;
                }
                chunks.push(c);
            });
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            res.on("error", reject);
        });
        req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung")));
        req.on("error", reject);
    });
}
async function fetchCompareTariff(prev, monthlyBaseEur, nowMs, fetchText = httpGetText) {
    const attemptedAt = new Date(nowMs).toISOString();
    try {
        const brutto = parseVerivoxAveragePrice(await fetchText(exports.VERIVOX_PRICE_URL));
        if (brutto === null)
            throw new Error("Preis auf der Seite nicht gefunden");
        return {
            fetchedAt: attemptedAt,
            attemptedAt,
            bruttoCtPerKwh: brutto,
            workCtPerKwh: workPriceFromBrutto(brutto, monthlyBaseEur),
            status: "ok",
            errorDe: null,
        };
    }
    catch (e) {
        return { ...prev, attemptedAt, status: prev.workCtPerKwh !== null ? prev.status : "error", errorDe: e instanceof Error ? e.message : String(e) };
    }
}
