"use strict";
/**
 * PHASE 4 — kompakte, strukturierte Tageszusammenfassung für die KI (kein Rohtelemetrie-Dump).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAiAnalystContext = void 0;
const MAX_FINDINGS_IN_CONTEXT = 60;
function buildAiAnalystContext(input) {
    const scores = input.record.scores.map((s) => ({ topic: s.topic, value: s.value, sampleCount: s.sampleCount }));
    const notableFindings = input.findings
        .filter((f) => !f.insufficientData && !f.notApplicable)
        .sort((a, b) => Math.abs(b.costImpactCt ?? 0) - Math.abs(a.costImpactCt ?? 0))
        .slice(0, MAX_FINDINGS_IN_CONTEXT)
        .map((f) => ({
        domain: f.domain,
        eventType: f.eventType,
        decisionQuality: f.quality.decisionQuality,
        outcomeQuality: f.quality.outcomeQuality,
        confidence: f.confidence,
        energyImpactKwh: f.energyImpactKwh,
        costImpactCt: f.costImpactCt,
        reasonCodes: f.reasonCodes,
        explanationDe: f.explanationDe.slice(0, 240),
    }));
    return {
        schemaVersion: 1,
        purpose: "daily_analyst_findings",
        dateKey: input.dateKey,
        globalScore: input.record.globalScore,
        scores,
        eligibility: input.record.eligibility.map((e) => ({
            domain: e.domain,
            status: e.status,
            coveragePct: e.coveragePct,
        })),
        findings: notableFindings,
        economics: input.economics
            ? {
                tarifvorteilEur: input.economics.tarifvorteilEur,
                emsVorteilEur: input.economics.emsVorteilEur,
                kiMehrwertEur: input.economics.kiMehrwertEur,
            }
            : null,
        shadow: input.shadow
            ? {
                realNetCostEur: input.shadow.real.netCostEur,
                referenceNoEmsNetCostEur: input.shadow.strategies.reference_no_ems?.netCostEur ?? null,
                emsWithoutAiNetCostEur: input.shadow.strategies.ems_without_ai?.netCostEur ?? null,
            }
            : null,
        constraints: {
            aiIsAnalystOnly: true,
            aiMustNotControlDevices: true,
            aiMustNotInventEuroSavings: true,
            aiMustReturnStructuredFindingsOnly: true,
        },
    };
}
exports.buildAiAnalystContext = buildAiAnalystContext;
