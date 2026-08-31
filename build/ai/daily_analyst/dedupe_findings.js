"use strict";
/**
 * Semantische Deduplizierung der Daily-Analyst-Findings: dasselbe reale Ereignis
 * (Domain, Lauf/Zeitfenster, Optimierungsproblem) nur einmal behalten.
 * Unterschiedliche echte Probleme bleiben getrennt — keine aggressive Fusion.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAnalystFindingsDe = exports.dedupeAnalystFindings = exports.analystFindingEventKey = void 0;
const SEVERITY_RANK = {
    info: 1,
    notice: 2,
    warning: 3,
};
const QUALITY_WORDS_RE = /\b(avoidable|early|late|too_early|too_late|decisionquality)\b/gi;
function extractQuantities(text) {
    const t = text.toLowerCase().replace(/,/g, ".");
    const kwh = [...t.matchAll(/(\d+(?:\.\d+)?)\s*kwh/g)].map((m) => Number(m[1]).toFixed(2));
    const mins = [...t.matchAll(/(\d+(?:\.\d+)?)\s*min(?:ute(?:n)?)?\b/g)].map((m) => String(Math.round(Number(m[1]))));
    return [...kwh, ...mins].join("|");
}
function qualityNormalized(text) {
    return text
        .toLowerCase()
        .replace(/decisionquality\s*=\s*\w+/gi, " ")
        .replace(QUALITY_WORDS_RE, " ")
        .replace(/\s+/g, " ")
        .trim();
}
/** Ereignis-/Problem-Schlüssel: Domain + Typ + Parameter + Richtung + Laufmengen bzw. normalisierter Text. */
function analystFindingEventKey(f) {
    const blob = `${f.observedBehaviorDe} ${f.evidence.join(" ")}`;
    const qty = extractQuantities(blob);
    const event = qty || qualityNormalized(`${f.observedBehaviorDe} ${f.suggestedImprovementDe}`).slice(0, 96);
    return [f.domain, f.findingType, f.affectedParameter ?? "", f.expectedDirection, event].join("::");
}
exports.analystFindingEventKey = analystFindingEventKey;
function mentionsAvoidable(f) {
    return /avoidable/i.test(`${f.observedBehaviorDe} ${f.evidence.join(" ")}`);
}
function preferFinding(a, b) {
    const sa = SEVERITY_RANK[a.severity] ?? 0;
    const sb = SEVERITY_RANK[b.severity] ?? 0;
    if (sa !== sb)
        return sa > sb ? a : b;
    if (a.confidencePct !== b.confidencePct)
        return a.confidencePct >= b.confidencePct ? a : b;
    const aAv = mentionsAvoidable(a);
    const bAv = mentionsAvoidable(b);
    if (aAv !== bAv)
        return aAv ? a : b;
    return a;
}
function uniqueStrings(values) {
    const seen = new Set();
    const out = [];
    for (const v of values) {
        const t = v.trim();
        if (!t)
            continue;
        const k = t.toLowerCase();
        if (seen.has(k))
            continue;
        seen.add(k);
        out.push(t);
    }
    return out;
}
function mergePair(a, b) {
    const winner = preferFinding(a, b);
    const loser = winner === a ? b : a;
    return {
        ...winner,
        evidence: uniqueStrings([...winner.evidence, ...loser.evidence]),
        proposedNumericValue: winner.proposedNumericValue ?? loser.proposedNumericValue,
        affectedParameter: winner.affectedParameter ?? loser.affectedParameter,
        uncertaintyDe: winner.uncertaintyDe || loser.uncertaintyDe,
    };
}
/** Führt semantisch gleiche Findings desselben Events zusammen; Reihenfolge der Erstvorkommen bleibt. */
function dedupeAnalystFindings(findings) {
    const byKey = new Map();
    const order = [];
    for (const f of findings) {
        const key = analystFindingEventKey(f);
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, f);
            order.push(key);
            continue;
        }
        byKey.set(key, mergePair(existing, f));
    }
    return order.map((k) => byKey.get(k));
}
exports.dedupeAnalystFindings = dedupeAnalystFindings;
/** Kompakte nummerierte VIS-/State-Darstellung — kein JSON-Dump. */
function formatAnalystFindingsDe(findings) {
    if (!findings.length)
        return "";
    return findings
        .map((f, i) => {
        const meta = `${f.severity} · ${Math.round(f.confidencePct)} %`;
        return `${i + 1}. ${f.observedBehaviorDe}\n   → ${f.suggestedImprovementDe}\n   (${meta})`;
    })
        .join("\n\n");
}
exports.formatAnalystFindingsDe = formatAnalystFindingsDe;
