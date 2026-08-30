/**
 * Kompakter PlannerKnowledgeSnapshot + Content-Hash Dedup.
 * Bewusst kleiner als voller UnifiedDayPlannerInput.
 */

import { createHash } from "node:crypto";
import type { UnifiedDayPlannerInput } from "../../operator/daily_plan/unified/types";
import { localDateKeyInTimezone } from "../../operator/time";
import type { PlannerKnowledgeSnapshot } from "./types";

function digestPresence(windows: Array<{ available: boolean; startIso: string; endIso: string }> | undefined): string | null {
	if (!windows?.length) return null;
	return windows
		.map((w) => `${w.available ? 1 : 0}:${w.startIso}:${w.endIso}`)
		.join("|")
		.slice(0, 512);
}

/**
 * Additiv (Block A): tatsächlich verwendeter Battery-Discharge-/Reserve-Kontext, 1:1 aus dem
 * bestehenden Decision-Pfad übernommen (resolveBatteryDischargeAuthorization +
 * resolveCentralBatteryReserveTarget + battery_hold_active). Keine neue Berechnung hier.
 */
export type BatteryDecisionSnapshotInput = {
	dischargeAllowed: boolean;
	priceAllowed: boolean;
	socAllowed: boolean;
	requiredSocAtPvEndPct: number | null;
	holdActive: boolean;
};

function deriveBatteryDecisionSnapshot(
	ctx: BatteryDecisionSnapshotInput | null | undefined,
): PlannerKnowledgeSnapshot["batteryDecision"] {
	if (!ctx) return null;
	if (ctx.holdActive) {
		return {
			action: "hold",
			dischargeAllowed: ctx.dischargeAllowed,
			requiredSocAtPvEndPct: ctx.requiredSocAtPvEndPct,
			holdActive: true,
			reasonCode: "battery_hold_active",
		};
	}
	if (ctx.dischargeAllowed) {
		return {
			action: "discharge_allowed",
			dischargeAllowed: true,
			requiredSocAtPvEndPct: ctx.requiredSocAtPvEndPct,
			holdActive: false,
			reasonCode: "price_and_reserve_ok",
		};
	}
	let reasonCode: NonNullable<PlannerKnowledgeSnapshot["batteryDecision"]>["reasonCode"] =
		"soc_below_reserve";
	if (ctx.requiredSocAtPvEndPct === null) reasonCode = "reserve_unknown";
	else if (!ctx.priceAllowed) reasonCode = "price_blocked";
	else if (!ctx.socAllowed) reasonCode = "soc_unknown";
	return {
		action: "discharge_blocked",
		dischargeAllowed: false,
		requiredSocAtPvEndPct: ctx.requiredSocAtPvEndPct,
		holdActive: false,
		reasonCode,
	};
}

/** Extrahiert minimalen Wissens-Snapshot aus Planner-Input. */
export function buildPlannerKnowledgeSnapshot(
	input: UnifiedDayPlannerInput,
	tsIso: string,
	extra?: { batteryDecision?: BatteryDecisionSnapshotInput | null },
): Omit<PlannerKnowledgeSnapshot, "id"> {
	const timezone = input.time?.timezone?.trim() || "Europe/Berlin";
	const nowMs = Date.parse(input.time?.nowIso ?? tsIso);
	const date =
		Number.isFinite(nowMs) ? localDateKeyInTimezone(new Date(nowMs), timezone) : "";

	const priceSlots: Array<[number, number]> = [];
	for (const s of input.prices?.slots ?? []) {
		const startMs = Date.parse(s.slot.startIso);
		const ct = s.importCtPerKwh;
		if (!Number.isFinite(startMs) || ct == null || !Number.isFinite(ct)) continue;
		priceSlots.push([startMs, ct]);
	}

	const pvSlotKwh: Array<[number, number]> = [];
	for (const s of input.pv?.slots ?? []) {
		const startMs = Date.parse(s.slot.startIso);
		const kwh = s.energyKwh;
		if (!Number.isFinite(startMs) || kwh == null || !Number.isFinite(kwh)) continue;
		pvSlotKwh.push([startMs, kwh]);
	}

	const climateUnits =
		input.climate?.units.map((u) => ({
			consumerId: u.unitId,
			sharedPowerGroupId: u.sharedPowerGroupId?.trim() || null,
			mandatory: u.mandatoryComfort === true,
			mode: null as string | null,
			hardOffAtIso:
				u.hardStopMs != null && Number.isFinite(u.hardStopMs)
					? new Date(u.hardStopMs).toISOString()
					: null,
			roomTempC: u.roomTempC ?? null,
			targetTempC: u.targetTempC ?? null,
			roomHumidityPct: u.roomHumidityPct ?? null,
			maxHumidityPct: u.maxHumidityPct ?? null,
		})) ?? [];

	return {
		tsIso,
		date,
		timezone,
		globalMode: input.globalMode ?? "",
		contributionRevision: input.contributionRevision ?? null,
		pvExpectedDayKwh: input.pv?.expectedDayEnergyKwh ?? null,
		houseLoadExpectedDayKwh: input.houseLoad?.expectedDayEnergyKwh ?? null,
		batterySocPct: input.battery?.socPct ?? null,
		batteryCapacityKwh: input.battery?.usableCapacityKwh ?? null,
		batteryNightReserveKwh: input.battery?.nightReserveKwh ?? null,
		priceSlots,
		pvSlotKwh,
		wallboxRequiredEnergyKwh: input.wallbox?.requiredEnergyKwh ?? null,
		wallboxDeadlineIso: input.wallbox?.deadlineIso ?? null,
		wallboxConnected: input.wallbox?.connectedNow ?? null,
		wallboxPresenceDigest: digestPresence(input.wallbox?.presenceWindows),
		thermalBufferTempC: input.thermal?.bufferTempC ?? null,
		thermalEmptyAtIso: input.thermal?.estimatedEmptyAtIso ?? null,
		thermalHeadroomKwh: input.thermal?.headroomEnergyKwh ?? null,
		climateUnits,
		wallboxTargetSocPct: input.wallbox?.targetSocPct ?? null,
		wallboxMinimumDepartureSocPct: input.wallbox?.minimumDepartureSocPct ?? null,
		wallboxEnergyGoalHard: input.wallbox?.energyGoalHard ?? null,
		wallboxManagementMode: input.wallbox?.managementMode ?? null,
		batteryDecision: deriveBatteryDecisionSnapshot(extra?.batteryDecision),
	};
}

/** Content-Hash über Snapshot ohne id/tsIso (tsIso ändert sich bei gleichem Inhalt). */
export function hashPlannerKnowledgeContent(
	snap: Omit<PlannerKnowledgeSnapshot, "id" | "tsIso"> & { tsIso?: string },
): string {
	const { tsIso: _t, ...rest } = snap as PlannerKnowledgeSnapshot;
	const payload = JSON.stringify(rest);
	return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function withSnapshotId(
	snap: Omit<PlannerKnowledgeSnapshot, "id">,
): PlannerKnowledgeSnapshot {
	return { ...snap, id: hashPlannerKnowledgeContent(snap) };
}

/**
 * Fügt Snapshot nur hinzu, wenn Inhalt neu ist.
 * Returns snapshotId (neu oder bestehend).
 */
export function upsertForecastSnapshot(
	list: PlannerKnowledgeSnapshot[],
	snap: PlannerKnowledgeSnapshot,
): { list: PlannerKnowledgeSnapshot[]; snapshotId: string; inserted: boolean } {
	const existing = list.find((s) => s.id === snap.id);
	if (existing) {
		return { list, snapshotId: existing.id, inserted: false };
	}
	return { list: [...list, snap], snapshotId: snap.id, inserted: true };
}
