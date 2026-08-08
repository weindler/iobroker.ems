/**
 * Deterministische Produkt-Zusammenfassung für Beta (kein KI-Zwang).
 * Baut auf UnifiedDayPlan + Day-Explanation-Fakten auf.
 */

import type { UnifiedDayPlan } from "../operator/daily_plan/unified/types";
import { buildDeterministicDayExplanation } from "../learning/day_evaluation/explain";

const MAX_LEN = 720;

function fmtKwh(n: number | null): string | null {
	if (n === null || !Number.isFinite(n)) return null;
	return n.toFixed(1).replace(".", ",");
}

function fmtEuroFromCt(ct: number | null): string | null {
	if (ct === null || !Number.isFinite(ct)) return null;
	return (ct / 100).toFixed(2).replace(".", ",");
}

function fmtClock(iso: string | null, timezone: string): string | null {
	if (!iso) return null;
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return null;
	try {
		return new Intl.DateTimeFormat("de-DE", {
			timeZone: timezone || "Europe/Berlin",
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date(ms));
	} catch {
		return iso.slice(11, 16);
	}
}

/** Kurze, nutzerlesbare Tageszusammenfassung. */
export function buildProductSummaryDe(
	plan: UnifiedDayPlan,
	opts?: { batteryStartSocPct?: number | null },
): string {
	const x = buildDeterministicDayExplanation(plan, opts);
	const parts: string[] = [];

	const pv = fmtKwh(x.heute.pvExpectedKwh);
	parts.push(pv !== null ? `Heute ${pv} kWh PV erwartet.` : "Heute PV-Erwartung unbekannt.");

	const batEnd = x.heute.batteryEndSocPct;
	if (batEnd !== null && Number.isFinite(batEnd)) {
		parts.push(`Batterie zum Tagesende ~${Math.round(batEnd)} %.`);
	}

	if (x.heizstab.windows.length > 0) {
		const w0 = x.heizstab.windows[0]!;
		const a = fmtClock(w0.startIso, x.timezone);
		const b = fmtClock(w0.endIso, x.timezone);
		const e = fmtKwh(x.heizstab.totalKwh);
		parts.push(
			a && b
				? `Heizstab ${a}–${b}${e ? ` (${e} kWh)` : ""}.`
				: `Heizstab geplant${e ? ` (${e} kWh)` : ""}.`,
		);
	}

	if (x.klima.totalKwh > 0) {
		parts.push(`Klima ~${fmtKwh(x.klima.totalKwh)} kWh geplant.`);
	}

	const req = fmtKwh(x.fahrzeug.requiredEnergyKwh);
	if (req !== null) {
		const dead = fmtClock(x.fahrzeug.deadlineIso, x.timezone);
		const pvE = fmtKwh(x.fahrzeug.plannedPvKwh);
		const gridE = fmtKwh(x.fahrzeug.plannedGridKwh);
		const cost = fmtEuroFromCt(x.fahrzeug.expectedGridCostCt);
		const goal = x.goals.find((g) => g.consumerId === "wallbox");
		const goalTxt =
			goal?.met === true
				? "Ziel erreichbar."
				: goal?.met === false
					? "Ziel gefährdet."
					: "Zielstatus unklar.";
		let line = `Fahrzeug benötigt ${req} kWh`;
		if (dead) line += ` bis ${dead}`;
		line += ".";
		if (pvE !== null || gridE !== null) {
			line += ` ${pvE ?? "?"} kWh PV + ${gridE ?? "?"} kWh Grid geplant.`;
		}
		if (cost !== null) line += ` Grid-Kosten ${cost} €.`;
		else if (x.fahrzeug.economicsCompleteness !== "full") {
			line += " Kosten nicht vollständig berechenbar.";
		}
		line += ` ${goalTxt}`;
		parts.push(line);
	}

	if (x.risiken.length > 0) {
		parts.push(`Hinweise: ${x.risiken.slice(0, 3).join(", ")}.`);
	}

	return parts.join(" ").slice(0, MAX_LEN);
}
