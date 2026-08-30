/**
 * BLOCK A — Domain-Eligibility. Domain-basiert statt global: ein Tag mit niedriger
 * Gesamt-Coverage (day.evaluable=false) kann trotzdem einzelne vollständig evaluierbare
 * Domänen liefern. day.evaluable bleibt reines Metadatum (Anzeige), kein Learning-Gate.
 *
 * not_applicable wird NIE allein aus einem hohen na-Anteil der Quality-Maske abgeleitet
 * (diese wäre bei „immer 0 W gemessen, aber Gerät gar nicht vorhanden“ irreführend —
 * siehe EV-Korrektur #7). Stattdessen: explizite Evidenz-Prüfung pro Domäne (Snapshot-
 * Felder, Status-Events, reale Bucket-Werte) UND erst danach Coverage-basierte
 * evaluable/insufficient_data-Entscheidung.
 */

import type { DayTelemetryDayRecord } from "../day_telemetry/types";
import { DOMAIN_QUALITY, TELEMETRY_DOMAIN, decodeDomainQuality, type TelemetryDomain } from "../day_telemetry/quality_mask";
import { DAILY_EVALUATOR_DOMAIN_COVERAGE_PCT } from "./constants";
import { EVALUATOR_DOMAIN, type DomainEligibility, type EvaluatorDomain } from "./types";

function sum(arr: Array<number | null>): number {
	let s = 0;
	for (const v of arr) if (v != null && Number.isFinite(v)) s += v;
	return s;
}

function anyNonNull(arr: Array<number | null>): boolean {
	return arr.some((v) => v != null && Number.isFinite(v));
}

function domainSlotCounts(
	day: DayTelemetryDayRecord,
	telemetryDomain: TelemetryDomain,
): { ok: number; missing: number; na: number; total: number } {
	let ok = 0;
	let missing = 0;
	let na = 0;
	const total = day.buckets.qualityMask.length;
	for (const mask of day.buckets.qualityMask) {
		if (mask == null) {
			missing++;
			continue;
		}
		const q = decodeDomainQuality(mask, telemetryDomain);
		if (q === DOMAIN_QUALITY.ok || q === DOMAIN_QUALITY.partial) ok++;
		else if (q === DOMAIN_QUALITY.na) na++;
		else missing++;
	}
	return { ok, missing, na, total };
}

/** Evidenz, dass die Domäne für dieses Haushalt/diesen Tag überhaupt existiert/relevant ist. */
function hasEvidence(day: DayTelemetryDayRecord, domain: EvaluatorDomain): boolean {
	const b = day.buckets;
	switch (domain) {
		case EVALUATOR_DOMAIN.BATTERY:
			return (
				anyNonNull(b.batterySocEndPct) ||
				sum(b.batteryChargedKwh) > 0 ||
				sum(b.batteryDischargedKwh) > 0 ||
				day.forecastSnapshots.some((s) => s.batterySocPct != null)
			);
		case EVALUATOR_DOMAIN.THERMAL:
			return (
				anyNonNull(b.boilerTempEndC) ||
				sum(b.immersionKwh) > 0 ||
				day.immersionRunSegments.length > 0 ||
				day.forecastSnapshots.some((s) => s.thermalBufferTempC != null)
			);
		case EVALUATOR_DOMAIN.CLIMATE:
			return (
				sum(b.climateKwh) > 0 ||
				sum(b.climateElecSharedKwh) > 0 ||
				day.climateRunSegments.length > 0 ||
				day.forecastSnapshots.some((s) => s.climateUnits.length > 0)
			);
		case EVALUATOR_DOMAIN.EV:
			return (
				day.statusEvents.some((e) => e.kind === "ev_connected") ||
				day.forecastSnapshots.some((s) => s.wallboxConnected === true) ||
				sum(b.evChargedKwh) > 0 ||
				anyNonNull(b.evSocEndPct)
			);
		default:
			return false;
	}
}

function telemetryDomainFor(domain: EvaluatorDomain): TelemetryDomain {
	switch (domain) {
		case EVALUATOR_DOMAIN.BATTERY:
			return TELEMETRY_DOMAIN.BATTERY;
		case EVALUATOR_DOMAIN.THERMAL:
			return TELEMETRY_DOMAIN.THERMAL;
		case EVALUATOR_DOMAIN.CLIMATE:
			return TELEMETRY_DOMAIN.CLIMATE;
		case EVALUATOR_DOMAIN.EV:
			return TELEMETRY_DOMAIN.EV;
	}
}

export function evaluateDomainEligibility(
	day: DayTelemetryDayRecord,
	domain: EvaluatorDomain,
): DomainEligibility {
	const counts = domainSlotCounts(day, telemetryDomainFor(domain));
	const coveragePct = counts.total > 0 ? Math.round((counts.ok / counts.total) * 1000) / 10 : 0;

	if (!hasEvidence(day, domain)) {
		return {
			domain,
			status: "not_applicable",
			coveragePct,
			observedOkSlotCount: counts.ok,
			missingSlotCount: counts.missing,
			naSlotCount: counts.na,
			totalSlotCount: counts.total,
			reasonCode: "no_evidence_of_domain",
			reasonDe: `Keine Evidenz für Domäne „${domain}“ an diesem Tag (weder Bucket-Werte noch Snapshot-/Event-Hinweise) — nicht anwendbar.`,
		};
	}

	if (coveragePct >= DAILY_EVALUATOR_DOMAIN_COVERAGE_PCT) {
		return {
			domain,
			status: "evaluable",
			coveragePct,
			observedOkSlotCount: counts.ok,
			missingSlotCount: counts.missing,
			naSlotCount: counts.na,
			totalSlotCount: counts.total,
			reasonCode: "coverage_sufficient",
			reasonDe: `Domain-Coverage ${coveragePct}% ≥ Schwelle ${DAILY_EVALUATOR_DOMAIN_COVERAGE_PCT}% — evaluierbar.`,
		};
	}

	return {
		domain,
		status: "insufficient_data",
		coveragePct,
		observedOkSlotCount: counts.ok,
		missingSlotCount: counts.missing,
		naSlotCount: counts.na,
		totalSlotCount: counts.total,
		reasonCode: "coverage_below_threshold",
		reasonDe: `Domain-Coverage ${coveragePct}% < Schwelle ${DAILY_EVALUATOR_DOMAIN_COVERAGE_PCT}% trotz Evidenz — zu wenig Daten für diesen Tag.`,
	};
}

export function evaluateAllDomainEligibility(day: DayTelemetryDayRecord): DomainEligibility[] {
	return Object.values(EVALUATOR_DOMAIN).map((d) => evaluateDomainEligibility(day, d));
}
