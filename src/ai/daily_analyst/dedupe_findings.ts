/**
 * Eventbezogene Deduplizierung der Daily-Analyst-Findings: dasselbe reale Ereignis
 * (Verbraucher, Laufmengen, Optimierungsursache) nur einmal behalten.
 * Unterschiedliche echte Probleme bleiben getrennt — keine aggressive Fusion.
 */

import type { AiAnalystFinding, AiAnalystSeverity } from "./types";

const SEVERITY_RANK: Record<AiAnalystSeverity, number> = {
	info: 1,
	notice: 2,
	warning: 3,
};

function allText(f: AiAnalystFinding): string {
	return `${f.observedBehaviorDe} ${f.suggestedImprovementDe} ${f.evidence.join(" ")}`;
}

function extractQuantities(text: string): string {
	const t = text.toLowerCase().replace(/,/g, ".");
	const kwh = [...t.matchAll(/(\d+(?:\.\d+)?)\s*kwh/g)].map((m) => Number(m[1]).toFixed(2));
	const mins = [...t.matchAll(/(\d+(?:\.\d+)?)\s*min(?:ute(?:n)?)?\b/g)].map((m) =>
		String(Math.round(Number(m[1]))),
	);
	return [...kwh, ...mins].join("|");
}

/** Verbraucherfamilie aus Text, sonst Domain — unabhängig von Quality-Labels. */
function consumerFamily(f: AiAnalystFinding): string {
	const t = allText(f).toLowerCase();
	if (/\bheizstab\b|\bimmersion\b/.test(t)) return "heater";
	if (/\bbatterie\b|\bnetzausgleich\b|\bsoc\b/.test(t)) return "battery";
	if (/\bklima\b|\bclimate\b/.test(t)) return "climate";
	if (/\bwallbox\b|\be-auto\b|\bschnellader\b/.test(t)) return "ev";
	return f.domain;
}

function sameWindowCause(a: AiAnalystFinding, b: AiAnalystFinding): boolean {
	const re = /pv|preis|fenster|zeitfenster|günstig|früh|spät|aktivier/;
	return re.test(allText(a).toLowerCase()) && re.test(allText(b).toLowerCase());
}

/** Event-Schlüssel nur für Tests/Diagnose — Merge nutzt `findingsAreSameEvent`. */
export function analystFindingEventKey(f: AiAnalystFinding): string {
	const qty = extractQuantities(allText(f));
	return [consumerFamily(f), f.expectedDirection, qty || f.findingType].join("::");
}

export function findingsAreSameEvent(a: AiAnalystFinding, b: AiAnalystFinding): boolean {
	if (a.dateKey && b.dateKey && a.dateKey !== b.dateKey) return false;
	const fa = consumerFamily(a);
	const fb = consumerFamily(b);
	if (fa !== fb) return false;
	if (
		a.expectedDirection !== b.expectedDirection &&
		a.expectedDirection !== "unclear" &&
		b.expectedDirection !== "unclear"
	) {
		return false;
	}
	const qa = extractQuantities(allText(a));
	const qb = extractQuantities(allText(b));
	if (qa && qb) return qa === qb;
	if ((qa && !qb) || (!qa && qb)) return sameWindowCause(a, b);
	return a.findingType === b.findingType && sameWindowCause(a, b);
}

function observationPrecision(f: AiAnalystFinding): number {
	const t = f.observedBehaviorDe;
	const digits = (t.match(/\d/g) ?? []).length;
	return digits * 10 + t.length;
}

function preferFinding(a: AiAnalystFinding, b: AiAnalystFinding): AiAnalystFinding {
	const sa = SEVERITY_RANK[a.severity] ?? 0;
	const sb = SEVERITY_RANK[b.severity] ?? 0;
	if (sa !== sb) return sa > sb ? a : b;
	if (a.confidencePct !== b.confidencePct) return a.confidencePct >= b.confidencePct ? a : b;
	return observationPrecision(a) >= observationPrecision(b) ? a : b;
}

function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const v of values) {
		const t = v.trim();
		if (!t) continue;
		const k = t.toLowerCase();
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(t);
	}
	return out;
}

function mergePair(a: AiAnalystFinding, b: AiAnalystFinding): AiAnalystFinding {
	const winner = preferFinding(a, b);
	const loser = winner === a ? b : a;
	const suggestion =
		winner.suggestedImprovementDe.length >= loser.suggestedImprovementDe.length
			? winner.suggestedImprovementDe
			: loser.suggestedImprovementDe;
	return {
		...winner,
		suggestedImprovementDe: suggestion,
		evidence: uniqueStrings([...winner.evidence, ...loser.evidence]),
		proposedNumericValue: winner.proposedNumericValue ?? loser.proposedNumericValue,
		affectedParameter: winner.affectedParameter ?? loser.affectedParameter,
		uncertaintyDe: winner.uncertaintyDe || loser.uncertaintyDe,
	};
}

/** Führt semantisch gleiche Findings desselben Events zusammen; Reihenfolge der Erstvorkommen bleibt. */
export function dedupeAnalystFindings(findings: AiAnalystFinding[]): AiAnalystFinding[] {
	const clusters: AiAnalystFinding[] = [];
	for (const f of findings) {
		let merged = false;
		for (let i = 0; i < clusters.length; i++) {
			if (findingsAreSameEvent(clusters[i]!, f)) {
				clusters[i] = mergePair(clusters[i]!, f);
				merged = true;
				break;
			}
		}
		if (!merged) clusters.push(f);
	}
	return clusters;
}

/** Kompakte nummerierte VIS-/State-Darstellung — kein JSON-Dump. */
export function formatAnalystFindingsDe(findings: AiAnalystFinding[]): string {
	if (!findings.length) return "";
	return findings
		.map((f, i) => {
			const meta = `${f.severity} · ${Math.round(f.confidencePct)} %`;
			return `${i + 1}. ${f.observedBehaviorDe}\n   → ${f.suggestedImprovementDe}\n   (${meta})`;
		})
		.join("\n\n");
}
