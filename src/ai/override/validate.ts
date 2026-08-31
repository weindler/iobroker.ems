/**
 * PHASE 6 — Deterministischer Validator für KI-Override-Vorschläge.
 *
 * Rein deterministisch, kein KI-Aufruf. Prüft ausschließlich gegen vom Aufrufer vorgegebene
 * Grenzen (`AiOverrideBounds`) — die KI selbst kann diese Grenzen nie setzen oder erweitern.
 * Nicht ausreichend belegte Empfehlungen werden abgelehnt, nicht geraten/geglättet.
 */

import { randomUUID } from "node:crypto";
import {
	isSafetyImmutableParameter,
	type AiOverrideBounds,
	type AiOverrideProposal,
	type ValidatedAiOverride,
} from "./types";

function round4(n: number): number {
	return Math.round(n * 10_000) / 10_000;
}

function rejected(
	proposal: AiOverrideProposal,
	reasonDe: string,
	nowIso: string,
	dateKey: string,
): ValidatedAiOverride {
	return {
		id: randomUUID(),
		parameter: proposal.parameter,
		originalValue: proposal.originalValue,
		proposedValue: proposal.proposedValue,
		validatedValue: null,
		reasoningDe: proposal.reasoningDe,
		evidence: proposal.evidence,
		confidencePct: proposal.confidencePct,
		source: proposal.source,
		status: "rejected",
		rejectReasonDe: reasonDe,
		createdAtIso: nowIso,
		expiresAtIso: nowIso,
		dateKey,
	};
}

/**
 * `bounds`: muss vom Aufrufer (Planner-/Policy-Seite) kommen, niemals aus dem KI-Vorschlag selbst
 * — sonst könnte eine KI ihre eigenen Grenzen definieren. `dateKey`: lokaler Kalendertag, für
 * Economics-Point-in-time-Zuordnung.
 */
export function validateOverrideProposal(
	proposal: AiOverrideProposal,
	bounds: AiOverrideBounds,
	dateKey: string,
	now: Date = new Date(),
): ValidatedAiOverride {
	const nowIso = now.toISOString();

	if (isSafetyImmutableParameter(proposal.parameter)) {
		return rejected(
			proposal,
			`Parameter "${proposal.parameter}" ist sicherheitsrelevant und für KI-Overrides grundsätzlich gesperrt.`,
			nowIso,
			dateKey,
		);
	}
	if (!Number.isFinite(proposal.proposedValue) || !Number.isFinite(proposal.originalValue)) {
		return rejected(proposal, "Vorgeschlagener oder ursprünglicher Wert ist keine gültige Zahl.", nowIso, dateKey);
	}
	if (!proposal.evidence || proposal.evidence.length === 0) {
		return rejected(proposal, "Keine Evidenz/Belege für die Empfehlung angegeben.", nowIso, dateKey);
	}
	if (proposal.sampleCount < bounds.minSampleCount) {
		return rejected(
			proposal,
			`Zu wenige Samples (${proposal.sampleCount} < ${bounds.minSampleCount}) — nicht ausreichend belegt.`,
			nowIso,
			dateKey,
		);
	}
	if (proposal.confidencePct < bounds.minConfidencePct) {
		return rejected(
			proposal,
			`Confidence zu niedrig (${proposal.confidencePct}% < ${bounds.minConfidencePct}%).`,
			nowIso,
			dateKey,
		);
	}
	if (proposal.dataAgeDays > bounds.maxDataAgeDays) {
		return rejected(
			proposal,
			`Zugrunde liegende Daten zu alt (${proposal.dataAgeDays}d > ${bounds.maxDataAgeDays}d).`,
			nowIso,
			dateKey,
		);
	}
	const changeAbs = Math.abs(proposal.proposedValue - proposal.originalValue);
	if (changeAbs > bounds.maxChangePerStepAbs) {
		return rejected(
			proposal,
			`Änderung zu groß (${round4(changeAbs)} > erlaubt ${bounds.maxChangePerStepAbs} pro Schritt).`,
			nowIso,
			dateKey,
		);
	}
	const validatedValue = round4(
		Math.max(bounds.minValue, Math.min(bounds.maxValue, proposal.proposedValue)),
	);
	if (validatedValue < bounds.minValue || validatedValue > bounds.maxValue) {
		return rejected(proposal, "Vorgeschlagener Wert außerhalb des erlaubten Wertebereichs.", nowIso, dateKey);
	}

	const expiresAtIso = new Date(now.getTime() + bounds.ttlMs).toISOString();
	return {
		id: randomUUID(),
		parameter: proposal.parameter,
		originalValue: proposal.originalValue,
		proposedValue: proposal.proposedValue,
		validatedValue,
		reasoningDe: proposal.reasoningDe,
		evidence: proposal.evidence,
		confidencePct: proposal.confidencePct,
		source: proposal.source,
		status: "active",
		rejectReasonDe: null,
		createdAtIso: nowIso,
		expiresAtIso,
		dateKey,
	};
}

/** TTL-Ablauf anwenden — "automatische Rückkehr zur normalen Konfiguration". */
export function sweepExpiredOverrides(
	overrides: ValidatedAiOverride[],
	now: Date = new Date(),
): ValidatedAiOverride[] {
	const nowMs = now.getTime();
	return overrides.map((o) => {
		if (o.status !== "active") return o;
		const expMs = Date.parse(o.expiresAtIso);
		if (Number.isFinite(expMs) && expMs <= nowMs) {
			return { ...o, status: "expired" as const };
		}
		return o;
	});
}

/** Aktuell wirksamer validierter Wert für einen Parameter — null = baseConfig/originalValue gilt. */
export function resolveActiveOverrideValue(
	overrides: ValidatedAiOverride[],
	parameter: string,
	now: Date = new Date(),
): number | null {
	const swept = sweepExpiredOverrides(overrides, now);
	const active = swept
		.filter((o) => o.parameter === parameter && o.status === "active")
		.sort((a, b) => Date.parse(b.createdAtIso) - Date.parse(a.createdAtIso));
	return active[0]?.validatedValue ?? null;
}
