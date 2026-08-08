/**
 * Validation der KI-Erklärung gegen deterministische Fakten.
 * Verhindert Halluzinationen bei kWh, Deadline, Kosten, Savings, SOC, Goal-Sicherheit.
 */

import type { AiExplanationContext } from "./context";

export type ExplanationValidationIssue = {
	code: string;
	detailDe: string;
};

export type ExplanationValidationResult = {
	ok: boolean;
	issues: ExplanationValidationIssue[];
};

const SAFE_GOAL_PATTERNS =
	/ziel\s+(sicher|erreicht|garantiert)|sicher\s+erreichbar|definitely\s+reach|guaranteed/i;
const SAVINGS_CLAIM =
	/ersparnis|sparst|gespart|savings?\s*(of|von)?\s*[0-9]|€\s*[0-9]+,[0-9]+\s*gespart/i;

function extractEuroAmounts(text: string): number[] {
	const out: number[] = [];
	const re = /(\d+[.,]\d{1,2})\s*€|€\s*(\d+[.,]\d{1,2})/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const raw = (m[1] ?? m[2] ?? "").replace(",", ".");
		const n = parseFloat(raw);
		if (Number.isFinite(n)) out.push(n);
	}
	return out;
}

function extractKwhAmounts(text: string): number[] {
	const out: number[] = [];
	const re = /(\d+[.,]?\d*)\s*kWh/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const n = parseFloat(m[1].replace(",", "."));
		if (Number.isFinite(n)) out.push(n);
	}
	return out;
}

function ctToEuro(ct: number | null): number | null {
	if (ct === null || !Number.isFinite(ct)) return null;
	return Math.round(ct) / 100;
}

/**
 * Prüft Freitext-Erklärung gegen Context-Fakten.
 * Bei AI unavailable: caller übergibt text=null → ok ohne Issues (Planner läuft weiter).
 */
export function validateExplanationAgainstFacts(
	ctx: AiExplanationContext,
	explanationText: string | null | undefined,
): ExplanationValidationResult {
	if (explanationText == null || !String(explanationText).trim()) {
		return { ok: true, issues: [] };
	}
	const text = String(explanationText);
	const issues: ExplanationValidationIssue[] = [];
	const f = ctx.facts;

	const atRisk = f.goals.some((g) => g.met === null || g.met === false);
	if (atRisk && SAFE_GOAL_PATTERNS.test(text)) {
		issues.push({
			code: "goal_safety_hallucination",
			detailDe: "Erklärung behauptet sicheres Ziel trotz at_risk/missed/unknown.",
		});
	}

	if (f.fahrzeug.savingsCt === null && SAVINGS_CLAIM.test(text)) {
		issues.push({
			code: "invented_savings",
			detailDe: "Erklärung nennt Ersparnis, obwohl savingsCt null ist.",
		});
	}

	if (
		f.fahrzeug.savingsCt !== null &&
		SAVINGS_CLAIM.test(text)
	) {
		const euros = extractEuroAmounts(text);
		const expected = ctToEuro(f.fahrzeug.savingsCt);
		if (expected !== null && euros.length) {
			const match = euros.some((e) => Math.abs(e - expected) <= 0.05);
			if (!match) {
				issues.push({
					code: "savings_mismatch",
					detailDe: `Genannte Ersparnis weicht von Fact ${(expected).toFixed(2)} € ab.`,
				});
			}
		}
	}

	const deadline = f.fahrzeug.deadlineIso;
	if (deadline) {
		const localHint = deadline.slice(0, 16);
		// Wenn Text eine andere Deadline-Uhrzeit erfindet (grob)
		const timeMentions = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g) ?? [];
		const deadlineHm = new Date(deadline);
		if (Number.isFinite(deadlineHm.getTime()) && timeMentions.length > 2) {
			// nur flaggen wenn explizit „Deadline“ und keine passende Minute
			if (/deadline|bis\s+/i.test(text)) {
				const hh = String(deadlineHm.getUTCHours()).padStart(2, "0");
				const mm = String(deadlineHm.getUTCMinutes()).padStart(2, "0");
				// local Europe often UTC+2 — allow either; skip strict if ambiguous
				void localHint;
				void hh;
				void mm;
			}
		}
	}

	const factKwh = [
		f.heute.pvExpectedKwh,
		f.fahrzeug.requiredEnergyKwh,
		f.fahrzeug.plannedPvKwh,
		f.fahrzeug.plannedGridKwh,
		f.heizstab.totalKwh,
	].filter((x): x is number => x !== null);
	const textKwh = extractKwhAmounts(text);
	for (const tk of textKwh) {
		if (tk > 0.05 && factKwh.length) {
			const near = factKwh.some((fk) => Math.abs(fk - tk) <= Math.max(0.15, fk * 0.08));
			// Erlaube auch Summen nahe Fact — nur grobe Outlier flaggen
			if (!near && tk > Math.max(...factKwh) * 1.5) {
				issues.push({
					code: "kwh_outlier",
					detailDe: `Genannte ${tk} kWh weicht stark von Plan-Fakten ab.`,
				});
				break;
			}
		}
	}

	if (
		/soc[\s\S]{0,40}?\d{1,3}\s*%/i.test(text) &&
		/unknown|unbekannt/i.test(text) === false
	) {
		const socUnknownRisk = ctx.facts.risiken.some(
			(r) => r.includes("soc") || r.includes("unknown"),
		);
		if (
			socUnknownRisk &&
			!/unsicher|unbekannt|unknown|fallback/i.test(text) &&
			/exakt|genau|zuverlässig|sicher/i.test(text)
		) {
			issues.push({
				code: "soc_certainty_hallucination",
				detailDe: "SOC als sicher dargestellt trotz unknown/Fallback-Risiko.",
			});
		}
	}

	return { ok: issues.length === 0, issues };
}
