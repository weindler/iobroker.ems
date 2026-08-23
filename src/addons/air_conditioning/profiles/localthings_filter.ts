/**
 * LocalThings Filterstatus — Gerätewert ist maßgebend, keine Ableitung aus Stunden.
 */

export type LocalthingsFilterStatus = "normal" | "wash" | "replace" | "unknown";

export function parseLocalthingsFilterStatus(raw: unknown): LocalthingsFilterStatus {
	const s = String(raw ?? "")
		.trim()
		.toLowerCase();
	if (s === "normal" || s === "ok" || s === "good") return "normal";
	if (s === "wash" || s === "clean" || s === "cleaning_required") return "wash";
	if (s === "replace" || s === "exchange") return "replace";
	if (!s) return "unknown";
	return "unknown";
}

export function localthingsFilterStatusLabelDe(status: LocalthingsFilterStatus): string {
	switch (status) {
		case "normal":
			return "Normal";
		case "wash":
			return "Reinigen";
		case "replace":
			return "Ersetzen";
		default:
			return "Unbekannt";
	}
}

export function formatLocalthingsFilterSummary(input: {
	usagePct: number | null;
	usageHours: number | null;
	statusRaw: unknown;
}): string {
	const st = parseLocalthingsFilterStatus(input.statusRaw);
	const pct =
		input.usagePct != null && Number.isFinite(input.usagePct) ? `${Math.round(input.usagePct)} %` : "—";
	const hours =
		input.usageHours != null && Number.isFinite(input.usageHours)
			? `${Math.round(input.usageHours)} h`
			: "—";
	return `Filter ${pct} · ${hours} · ${localthingsFilterStatusLabelDe(st)}`;
}
