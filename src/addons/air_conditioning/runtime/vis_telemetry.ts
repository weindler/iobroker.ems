/**
 * Normalisierte AC-Werte für VIS (Power-Anzeige, Filter) — keine Write-Logik.
 */

import {
	localthingsFilterStatusLabelDe,
	parseLocalthingsFilterStatus,
	type LocalthingsFilterStatus,
} from "../profiles/localthings_filter";

export type AcPowerDisplayKind = "measured" | "estimated" | "none";

export type AcPowerDisplay = {
	measuredPowerW: number | null;
	displayPowerW: number | null;
	kind: AcPowerDisplayKind;
};

/**
 * Messwert nur wenn bereits plausibel gefiltert (nicht 0 W bei AC an).
 * Sonst bei Betrieb Fallback auf geschätzte/gelernte Leistung.
 */
export function resolveAcPowerDisplay(input: {
	measuredPowerW: number | null;
	estimatedPowerW: number | null;
	running: boolean;
}): AcPowerDisplay {
	const meas = input.measuredPowerW;
	if (meas != null && Number.isFinite(meas) && meas > 0) {
		return { measuredPowerW: Math.round(meas), displayPowerW: Math.round(meas), kind: "measured" };
	}
	if (input.running) {
		const est = input.estimatedPowerW;
		if (est != null && Number.isFinite(est) && est > 0) {
			return { measuredPowerW: null, displayPowerW: Math.round(est), kind: "estimated" };
		}
	}
	return { measuredPowerW: null, displayPowerW: null, kind: "none" };
}

/** Kurzlabels für VIS-Kachel (User-Auftrag). */
export function acFilterStatusLabelShortDe(status: LocalthingsFilterStatus): string {
	switch (status) {
		case "normal":
			return "Normal";
		case "wash":
			return "Reinigen";
		case "replace":
			return "Ersetzen";
		default:
			return "";
	}
}

/**
 * Numerischer Filtercode für VIS/Diagnose (keine Regelung).
 * normal→0, wash→1, replace→2, sonst/fehlend→-1.
 */
export function acFilterStatusCode(status: LocalthingsFilterStatus | "" | string | null | undefined): number {
	const s = String(status ?? "")
		.trim()
		.toLowerCase();
	if (s === "normal") return 0;
	if (s === "wash") return 1;
	if (s === "replace") return 2;
	return -1;
}

export function resolveAcFilterVis(input: {
	statusRaw: unknown;
	usagePct: number | null;
	usageHours: number | null;
}): {
	status: LocalthingsFilterStatus | "";
	labelDe: string;
	usagePct: number | null;
	usageHours: number | null;
	warnDe: string;
} {
	const hasAny =
		(input.statusRaw != null && String(input.statusRaw).trim() !== "") ||
		(input.usagePct != null && Number.isFinite(input.usagePct)) ||
		(input.usageHours != null && Number.isFinite(input.usageHours));
	if (!hasAny) {
		return { status: "", labelDe: "", usagePct: null, usageHours: null, warnDe: "" };
	}
	const parsed = parseLocalthingsFilterStatus(input.statusRaw);
	const status: LocalthingsFilterStatus | "" =
		parsed === "unknown" && String(input.statusRaw ?? "").trim() === "" ? "" : parsed;
	const labelDe =
		!status || status === "unknown" ? "" : acFilterStatusLabelShortDe(status);
	let warnDe = "";
	if (status === "wash") warnDe = "FILTER REINIGEN";
	if (status === "replace") warnDe = "FILTER ERSETZEN";
	const pct =
		input.usagePct != null && Number.isFinite(input.usagePct) ? Math.round(input.usagePct) : null;
	const hours =
		input.usageHours != null && Number.isFinite(input.usageHours)
			? Math.round(input.usageHours)
			: null;
	return {
		status: status === "unknown" ? "" : status,
		labelDe:
			labelDe ||
			(status === "unknown" ? "" : localthingsFilterStatusLabelDe(parsed)),
		usagePct: pct,
		usageHours: hours,
		warnDe,
	};
}
