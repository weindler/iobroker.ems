import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUTION_IDS } from "../../../operator/contribution_ids";
import { addonContributorRef } from "../../../operator/contributor";
import type { DailyAllocationEntry } from "../../../operator/daily_plan/types";
import { slotStartIsoFloored, DAILY_PLAN_SLOT_MS } from "../../../operator/daily_plan/slots";
import { isoFromMs } from "../../../operator/time";
import { evaluateWallboxDailyPlan, type WallboxTelemetryInput } from "./daily_plan.js";
import { buildWallboxDispatchIntent } from "./intent.js";

const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = slotStartIsoFloored(NOW, TZ);
const SLOT_END = isoFromMs(Date.parse(SLOT_START) + DAILY_PLAN_SLOT_MS);
const DEADLINE = "2026-07-11T14:00:00.000Z";

function telemetry(over: Partial<WallboxTelemetryInput> = {}): WallboxTelemetryInput {
	return {
		connected: true,
		charging: false,
		vehicleSocPct: 40,
		planSocPct: 80,
		planActive: true,
		sessionEnergyKwh: 5,
		effectivePlanTime: DEADLINE,
		planTime: DEADLINE,
		activePhases: 1,
		configuredPhases: 3,
		minCurrentA: 6,
		maxCurrentA: 16,
		chargePowerW: null,
		evccConfigured: true,
		mappingsReady: true,
		...over,
	};
}

function allocationEntry(
	allocatedPowerW: number | null,
	status: DailyAllocationEntry["status"] = "allocated",
): DailyAllocationEntry {
	return {
		contributionId: CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
		contributor: addonContributorRef("wallbox"),
		slot: { startIso: SLOT_START, endIso: SLOT_END },
		status,
		energySource: "grid",
		requestedPowerW: allocatedPowerW,
		allocatedPowerW,
		requestedEnergyKwh: null,
		allocatedEnergyKwh: allocatedPowerW !== null ? (allocatedPowerW * 0.25) / 1000 : null,
		gridPowerW: allocatedPowerW ?? 0,
		pvPowerW: 0,
		mandatory: false,
		priorityRank: 1,
		deadlineIso: DEADLINE,
		estimatedCostCt: 12,
		reasonDe: "test",
	};
}

function decision(
	entries: DailyAllocationEntry[],
	tel: WallboxTelemetryInput = telemetry(),
	over: Partial<Parameters<typeof evaluateWallboxDailyPlan>[0]> = {},
) {
	return evaluateWallboxDailyPlan({
		now: NOW,
		timezone: TZ,
		meta: { status: "ready", date: "2026-07-11", revision: 7, validUntil: null, timezone: TZ },
		entries,
		telemetry: tel,
		governanceEnabled: true,
		addonEnabled: true,
		...over,
	});
}

function intentFrom(
	entries: DailyAllocationEntry[],
	tel = telemetry(),
	opts: {
		governanceEnabled?: boolean;
		addonEnabled?: boolean;
		meta?: Parameters<typeof evaluateWallboxDailyPlan>[0]["meta"];
	} = {},
) {
	const d = decision(entries, tel, {
		governanceEnabled: opts.governanceEnabled ?? true,
		addonEnabled: opts.addonEnabled ?? true,
		meta: opts.meta ?? { status: "ready", date: "2026-07-11", revision: 7, validUntil: null, timezone: TZ },
	});
	return buildWallboxDispatchIntent({
		decision: d,
		governanceEnabled: opts.governanceEnabled ?? true,
		addonEnabled: opts.addonEnabled ?? true,
		phases: tel.activePhases ?? tel.configuredPhases,
		now: NOW,
	});
}

describe("wallbox dispatch intent", () => {
	it("disconnected produces none", () => {
		const i = intentFrom([allocationEntry(3600)], telemetry({ connected: false, vehicleSocPct: 0 }));
		assert.equal(i.action, "none");
		assert.equal(i.enabled, false);
		assert.equal(i.targetPowerW, 0);
		assert.equal(i.targetCurrentA, null);
	});

	it("connected with positive allocation produces charge", () => {
		const i = intentFrom([allocationEntry(3600)]);
		assert.equal(i.action, "charge");
		assert.equal(i.enabled, true);
		assert.equal(i.targetPowerW, 3600);
		assert.equal(i.dailyPlanRevision, 7);
		assert.ok(i.validUntil);
	});

	it("valid zero allocation produces hold", () => {
		const i = intentFrom([]);
		assert.equal(i.action, "hold");
		assert.equal(i.enabled, false);
		assert.equal(i.targetPowerW, 0);
	});

	it("missing plan produces none", () => {
		const i = intentFrom([], telemetry(), {
			meta: { status: "not_initialized", date: "2026-07-11", revision: 0, validUntil: null, timezone: TZ },
		});
		assert.equal(i.action, "none");
		assert.equal(i.enabled, false);
	});

	it("invalid plan produces none", () => {
		const i = intentFrom([allocationEntry(3600), allocationEntry(1800)]);
		assert.equal(i.action, "none");
	});

	it("governance off produces none", () => {
		const i = intentFrom([allocationEntry(3600)], telemetry(), { governanceEnabled: false });
		assert.equal(i.action, "none");
	});

	it("addon disabled produces none", () => {
		const i = intentFrom([allocationEntry(3600)], telemetry(), { addonEnabled: false });
		assert.equal(i.action, "none");
	});

	it("mapping incomplete produces none", () => {
		const i = intentFrom([allocationEntry(3600)], telemetry({ mappingsReady: false }));
		assert.equal(i.action, "none");
	});

	it("pv source is mapped", () => {
		const entry = allocationEntry(3600);
		entry.energySource = "pv_surplus";
		const i = intentFrom([entry]);
		assert.equal(i.source, "pv_surplus");
		assert.match(i.reasonDe, /PV/);
	});

	it("below min power allocation produces hold", () => {
		const i = intentFrom([allocationEntry(800)], telemetry({ activePhases: 1, minCurrentA: 6 }));
		assert.equal(i.action, "hold");
		assert.match(i.reasonDe, /Mindestladeleistung/);
	});
});
