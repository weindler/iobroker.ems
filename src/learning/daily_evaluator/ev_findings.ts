/**
 * BLOCK A — EV/Wallbox Findings.
 *
 * not_applicable für die EV-Domäne wird NICHT hier entschieden (siehe eligibility.ts,
 * Korrektur #7 — kombiniert Snapshot-WallboxConnected, Status-Events und Slot-Daten).
 * Diese Datei liefert nur Findings für Tage, an denen die Domäne bereits als evaluable/
 * insufficient_data eingestuft wurde (also Evidenz für EV-Aktivität existiert).
 *
 * v1 bewusst ohne Cross-Day-Deadlines (Zielzeit vor Mitternacht des Vortages oder nach
 * Mitternacht des Folgetages) — solche Fälle bleiben insufficient_data statt geraten.
 */

import type { DayTelemetryDayRecord } from "../day_telemetry/types";
import { buildDaySlotLayout, slotIndexForMs } from "../day_telemetry/slots";
import type { EvaluatorFinding } from "./types";

function sum(arr: Array<number | null>): number {
	let s = 0;
	for (const v of arr) if (v != null && Number.isFinite(v)) s += v;
	return s;
}

export function evaluateEvFindings(day: DayTelemetryDayRecord): EvaluatorFinding[] {
	const findings: EvaluatorFinding[] = [];
	const layout = buildDaySlotLayout(day.dateKey, day.timezone);

	const byDeadline = new Map<string, (typeof day.forecastSnapshots)[number]>();
	for (const s of day.forecastSnapshots) {
		const target = s.wallboxTargetSocPct ?? s.wallboxMinimumDepartureSocPct;
		if (target == null || !s.wallboxDeadlineIso) continue;
		const existing = byDeadline.get(s.wallboxDeadlineIso);
		if (!existing || Date.parse(s.tsIso) > Date.parse(existing.tsIso)) {
			byDeadline.set(s.wallboxDeadlineIso, s);
		}
	}

	for (const [deadlineIso, snap] of byDeadline) {
		const deadlineMs = Date.parse(deadlineIso);
		if (!Number.isFinite(deadlineMs) || deadlineMs < day.startMs || deadlineMs >= day.endMs) continue;

		const idx = slotIndexForMs(layout, deadlineMs) ?? layout.slotCount - 1;
		let observedSoc: number | null = null;
		for (let i = idx; i >= 0; i--) {
			const v = day.buckets.evSocEndPct[i];
			if (v != null && Number.isFinite(v)) {
				observedSoc = v;
				break;
			}
		}
		const target = snap.wallboxTargetSocPct ?? snap.wallboxMinimumDepartureSocPct!;
		const insufficientData = observedSoc == null;
		const met = !insufficientData && observedSoc! >= target;

		findings.push({
			id: `ev-readiness-${day.dateKey}-${deadlineMs}`,
			dateKey: day.dateKey,
			tsStartIso: snap.tsIso,
			tsEndIso: deadlineIso,
			domain: "ev",
			assetRef: "wallbox",
			eventType: "ev_readiness_check",
			quality: {
				decisionQuality: "reasonable",
				outcomeQuality: insufficientData ? "unknown" : met ? "reasonable" : "avoidable",
			},
			confidence: insufficientData ? null : 70,
			snapshotIdRef: snap.id,
			measurements: {
				targetSocPct: target,
				observedSocPctAtDeadline: observedSoc,
				energyGoalHard: snap.wallboxEnergyGoalHard === true ? 1 : snap.wallboxEnergyGoalHard === false ? 0 : null,
			},
			energyImpactKwh: null,
			costImpactCt: null,
			reasonCodes: [insufficientData ? "ev_soc_unknown_at_deadline" : met ? "ev_readiness_met" : "ev_readiness_missed"],
			explanationDe: insufficientData
				? `EV-Ziel ${target.toFixed(0)}% zur Deadline ${deadlineIso} bekannt, aber Ist-SOC zu diesem Zeitpunkt nicht messbar.`
				: `EV-Ziel ${target.toFixed(0)}% zur Deadline ${deadlineIso}: Ist ${observedSoc!.toFixed(0)}% — ${met ? "erreicht" : "verfehlt"}.`,
			insufficientData,
			notApplicable: false,
			userOverride: false,
		});
	}

	const chargedKwh = sum(day.buckets.evChargedKwh);
	if (chargedKwh > 0 && byDeadline.size === 0) {
		findings.push({
			id: `ev-charging-${day.dateKey}`,
			dateKey: day.dateKey,
			tsStartIso: new Date(day.startMs).toISOString(),
			tsEndIso: new Date(day.endMs).toISOString(),
			domain: "ev",
			assetRef: "wallbox",
			eventType: "ev_charging_no_target_known",
			quality: { decisionQuality: "unknown", outcomeQuality: "unknown" },
			confidence: null,
			snapshotIdRef: null,
			measurements: { chargedKwh: Math.round(chargedKwh * 1000) / 1000 },
			energyImpactKwh: Math.round(chargedKwh * 1000) / 1000,
			costImpactCt: null,
			reasonCodes: ["no_target_or_deadline_known"],
			explanationDe: `EV-Ladung ${chargedKwh.toFixed(2)} kWh an diesem Tag, aber kein Ziel-SOC/Deadline in Snapshots bekannt — Readiness nicht bewertbar.`,
			insufficientData: true,
			notApplicable: false,
			userOverride: false,
		});
	}

	return findings;
}
