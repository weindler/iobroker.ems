"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateCostEurFromCharCount = exports.estimateCostEur = exports.USD_TO_EUR_APPROX = void 0;
/**
 * Grobe Preistabelle (USD je 1M Tokens) — Stand siehe io-package.json News dieser Version.
 * Dient nur der Kostenschätzung/Tageslimit-Anzeige im Admin, keine Abrechnungsgrundlage.
 * OpenAI ändert Preise gelegentlich — Tabelle bei Bedarf in einer künftigen Version aktualisieren.
 */
const USD_PER_1M_TOKENS = {
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4.1": { input: 2.0, output: 8.0 },
    "gpt-5-mini": { input: 0.25, output: 2.0 },
};
/** Grobe, feste Umrechnung — kein Live-Kurs, nur für die Schätzanzeige. */
exports.USD_TO_EUR_APPROX = 0.92;
function estimateCostEur(model, promptTokens, completionTokens) {
    const price = USD_PER_1M_TOKENS[model] ?? USD_PER_1M_TOKENS[Object.keys(USD_PER_1M_TOKENS)[0]];
    const inTok = promptTokens ?? 0;
    const outTok = completionTokens ?? 0;
    const usd = (inTok / 1_000_000) * price.input + (outTok / 1_000_000) * price.output;
    return Math.round(usd * exports.USD_TO_EUR_APPROX * 100_000) / 100_000;
}
exports.estimateCostEur = estimateCostEur;
/** Grobe Vorab-Schätzung ohne Usage (z. B. für Anzeige vor dem ersten Call). */
function estimateCostEurFromCharCount(model, promptChars, expectedCompletionChars = 400) {
    // ~4 Zeichen/Token Faustregel (Englisch/gemischt), bewusst grob.
    const promptTokens = Math.ceil(promptChars / 4);
    const completionTokens = Math.ceil(expectedCompletionChars / 4);
    return estimateCostEur(model, promptTokens, completionTokens);
}
exports.estimateCostEurFromCharCount = estimateCostEurFromCharCount;
