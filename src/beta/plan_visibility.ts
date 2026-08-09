/**
 * Autoritativer Plan-Sichtbarkeit (Beta Plan vs Runtime).
 *
 * plan_json = Zeit-/Leistungsfenster für Agenda/Karte.
 * Chart/Contribution dürfen keine nicht vorhandenen Allocations als GEPLANT erfinden.
 * Keine Write-Gates, kein Planner-/FSM-Umbau.
 */

export const PLAN_VIS_ON_W = 50;
export const PLAN_SLOT_MS = 15 * 60 * 1000;

export type PlanVisSlot = {
	startIso: string;
	endIso: string;
	startMs: number;
	endMs: number;
	powerW: number;
	contributionId: string;
};

export type PlanVisWindow = {
	startIso: string;
	endIso: string;
	startMs: number;
	endMs: number;
	/** Leistung dieses Fensters (kein Leak aus anderen Slots). */
	powerW: number;
	contributionId: string | null;
};

type RawAlloc = {
	contributionId?: unknown;
	allocatedPowerW?: unknown;
	slot?: { startIso?: unknown; endIso?: unknown };
};

function parseJsonArray(raw: unknown): unknown[] {
	if (Array.isArray(raw)) return raw;
	if (typeof raw === "string" && raw.trim()) {
		try {
			const v = JSON.parse(raw);
			return Array.isArray(v) ? v : [];
		} catch {
			return [];
		}
	}
	return [];
}

function finiteMs(iso: unknown): number | null {
	if (typeof iso !== "string" || !iso.trim()) return null;
	const ms = Date.parse(iso);
	return Number.isFinite(ms) ? ms : null;
}

/**
 * Flache Allocation-Slots aus plan_json (Power ≥ floor, Slotende > now).
 */
export function collectPlanVisSlots(
	planJson: unknown,
	opts?: {
		nowMs?: number;
		minW?: number;
		contributionId?: string | null;
		contributionIdPrefix?: string | null;
	},
): PlanVisSlot[] {
	const nowMs = opts?.nowMs ?? Date.now();
	const minW = opts?.minW ?? PLAN_VIS_ON_W;
	const exact = opts?.contributionId ?? null;
	const prefix = opts?.contributionIdPrefix ?? null;
	const out: PlanVisSlot[] = [];

	for (const row of parseJsonArray(planJson)) {
		if (!row || typeof row !== "object") continue;
		const a = row as RawAlloc;
		const cid = typeof a.contributionId === "string" ? a.contributionId : "";
		if (exact && cid !== exact) continue;
		if (prefix && !cid.startsWith(prefix)) continue;
		const w = typeof a.allocatedPowerW === "number" ? a.allocatedPowerW : Number(a.allocatedPowerW);
		if (!Number.isFinite(w) || w < minW) continue;
		const startIso = typeof a.slot?.startIso === "string" ? a.slot.startIso : "";
		const startMs = finiteMs(startIso);
		if (startMs === null) continue;
		const endIsoRaw = typeof a.slot?.endIso === "string" ? a.slot.endIso : "";
		const endParsed = finiteMs(endIsoRaw);
		const endMs = endParsed ?? startMs + PLAN_SLOT_MS;
		const endIso = endIsoRaw && Number.isFinite(endParsed as number) ? endIsoRaw : new Date(endMs).toISOString();
		if (endMs <= nowMs) continue;
		out.push({
			startIso,
			endIso,
			startMs,
			endMs,
			powerW: w,
			contributionId: cid,
		});
	}
	out.sort((a, b) => a.startMs - b.startMs || a.contributionId.localeCompare(b.contributionId));
	return out;
}

/**
 * Benachbarte Slots → Fenster; powerW = Max nur innerhalb dieses Fensters (kein globaler maxW).
 */
export function collapsePlanVisWindows(slots: PlanVisSlot[]): PlanVisWindow[] {
	if (slots.length === 0) return [];
	const sorted = slots.slice().sort((a, b) => a.startMs - b.startMs);
	const ranges: PlanVisWindow[] = [];
	let cur = {
		startIso: sorted[0]!.startIso,
		endIso: sorted[0]!.endIso,
		startMs: sorted[0]!.startMs,
		endMs: sorted[0]!.endMs,
		powerW: sorted[0]!.powerW,
		contributionId: sorted[0]!.contributionId as string | null,
	};
	for (let i = 1; i < sorted.length; i++) {
		const s = sorted[i]!;
		const sameAddon =
			cur.contributionId === null || s.contributionId === cur.contributionId || cur.contributionId === "";
		if (sameAddon && s.startMs <= cur.endMs + 1000) {
			if (s.endMs >= cur.endMs) {
				cur.endMs = s.endMs;
				cur.endIso = s.endIso;
			}
			cur.powerW = Math.max(cur.powerW, s.powerW);
			if (cur.contributionId && s.contributionId !== cur.contributionId) cur.contributionId = null;
		} else {
			ranges.push(cur);
			cur = {
				startIso: s.startIso,
				endIso: s.endIso,
				startMs: s.startMs,
				endMs: s.endMs,
				powerW: s.powerW,
				contributionId: s.contributionId,
			};
		}
	}
	ranges.push(cur);
	return ranges;
}

/** Autoritatives Immersion-Timeline: nur plan_json, nie Chart. */
export function immersionTimelineWindowsFromPlanJson(
	planJson: unknown,
	nowMs: number = Date.now(),
): PlanVisWindow[] {
	// IH-Slice enthält nur Heizstab-Einträge; Prefix filtert Misch-JSON ab.
	const slots = collectPlanVisSlots(planJson, {
		nowMs,
		contributionIdPrefix: "immersion_heater",
	});
	return collapsePlanVisWindows(slots.length > 0 ? slots : collectPlanVisSlots(planJson, { nowMs }));
}

export function climateUnitTimelineWindowsFromPlanJson(
	planJson: unknown,
	unitIndex: number,
	nowMs: number = Date.now(),
): PlanVisWindow[] {
	const cid = `air_conditioning.unit_${unitIndex}`;
	return collapsePlanVisWindows(collectPlanVisSlots(planJson, { nowMs, contributionId: cid }));
}

export function currentPlanVisWindow(
	windows: PlanVisWindow[],
	nowMs: number,
): PlanVisWindow | null {
	return windows.find((w) => nowMs >= w.startMs && nowMs < w.endMs) ?? null;
}

export function nextPlanVisWindow(windows: PlanVisWindow[], nowMs: number): PlanVisWindow | null {
	const future = windows
		.filter((w) => w.startMs > nowMs)
		.sort((a, b) => a.startMs - b.startMs);
	return future[0] ?? null;
}

export function firstOpenPlanVisWindow(
	windows: PlanVisWindow[],
	nowMs: number,
): PlanVisWindow | null {
	const open = windows
		.filter((w) => w.endMs > nowMs)
		.sort((a, b) => a.startMs - b.startMs);
	return open[0] ?? null;
}

/** Chart-Starts, die nicht in plan_json vorkommen — dürfen keine GEPLANT-Zeile erzeugen. */
export function chartStartsAbsentFromPlan(
	chartStartMs: number[],
	planWindows: PlanVisWindow[],
	slotMs: number = PLAN_SLOT_MS,
): number[] {
	return chartStartMs.filter((start) => {
		const end = start + slotMs;
		return !planWindows.some((w) => start < w.endMs && end > w.startMs);
	});
}

export function isOutsideClockWindowReason(reasonDe: string | null | undefined): boolean {
	return /Außerhalb Zeitfenster|außerhalb Betriebszeit/i.test(String(reasonDe ?? ""));
}

export function formatPlanWindowClockDe(
	startIso: string,
	endIso: string,
	timezone: string = "Europe/Berlin",
): string {
	const fmt = (iso: string): string => {
		try {
			return new Intl.DateTimeFormat("de-DE", {
				timeZone: timezone,
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			}).format(new Date(iso));
		} catch {
			const d = new Date(iso);
			if (!Number.isFinite(d.getTime())) return "—";
			return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
		}
	};
	const a = fmt(startIso);
	const b = fmt(endIso);
	return a === b ? a : `${a}–${b}`;
}

export function climatePlanLineFromWindowsDe(input: {
	currentAllocatedPowerW: number | null | undefined;
	nextWindow: PlanVisWindow | null;
	timezone?: string;
	minW?: number;
}): string {
	const minW = input.minW ?? PLAN_VIS_ON_W;
	const cur =
		input.currentAllocatedPowerW != null &&
		Number.isFinite(input.currentAllocatedPowerW) &&
		input.currentAllocatedPowerW >= minW
			? Math.round(input.currentAllocatedPowerW)
			: null;
	if (cur != null) return `Budget ${cur} W`;
	if (input.nextWindow) {
		const range = formatPlanWindowClockDe(
			input.nextWindow.startIso,
			input.nextWindow.endIso,
			input.timezone ?? "Europe/Berlin",
		);
		return `nächstes ${range} · ${Math.round(input.nextWindow.powerW)} W`;
	}
	return "kein Budget";
}

export function climateHeuteLineFromPlanDe(input: {
	likelyActiveToday?: boolean | null;
	expectedHoursToday?: number | null;
	expectedKwhToday?: number | null;
	hasPlanToday: boolean;
}): string {
	if (
		input.likelyActiveToday === true &&
		input.expectedHoursToday != null &&
		Number.isFinite(input.expectedHoursToday) &&
		input.expectedKwhToday != null &&
		Number.isFinite(input.expectedKwhToday)
	) {
		const h = input.expectedHoursToday;
		const k = input.expectedKwhToday;
		return `~${h.toFixed(1).replace(/\.0$/, "")} h / ${k.toFixed(1).replace(".", ",")} kWh heute`;
	}
	if (input.hasPlanToday) return "Klima im Tagesplan";
	return "heute keine geplante Klimaaktion";
}
