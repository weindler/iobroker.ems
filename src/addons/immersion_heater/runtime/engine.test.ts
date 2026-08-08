import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
	runImmersionRuntimeTick,
	resetImmersionRuntimeForTest,
	getImmersionPersistForTest,
	type ImmersionRuntimeHost,
} from "./engine.js";
import { IMMERSION_RUNTIME_STATES } from "./types.js";
import { DAILY_PLAN_STATE_IDS, ALLOCATION_ADDON_STATE_IDS } from "../../../operator/daily_plan/states.js";
import { CONTRIBUTION_IDS } from "../../../operator/contribution_ids.js";
import { addonContributorRef } from "../../../operator/contributor.js";
import { slotStartIsoFloored, DAILY_PLAN_SLOT_MS } from "../../../operator/daily_plan/slots.js";
import { localDateKeyInTimezone } from "../../../operator/time.js";
import { addonEnabled, addonAvailable } from "../../../tree_paths.js";
import type { DailyAllocationEntry } from "../../../operator/daily_plan/types.js";

/**
 * Roadmap Block 3.1: `runImmersionRuntimeTick` darf im Auto-Modus nur noch den Daily Plan oder
 * (wenn dieser nicht verwendbar ist) einen lokalen Sicherheits-Default nutzen — nie mehr
 * `planner.intent.thermal.*` (alter Realtime-Planner). Jeder Testfall seedet bewusst abweichende
 * Legacy-Planner-Werte, um zu belegen, dass sie ignoriert werden.
 */

const TZ = "UTC";
// Slot/Datum werden bewusst zur Testlaufzeit aus der echten Uhrzeit abgeleitet, weil
// `runImmersionRuntimeTick` selbst `new Date()` verwendet (keine injizierbare Uhr).
function realNow(): Date {
	return new Date();
}

const CONFIG: Record<string, unknown> = {
	intent_timezone: TZ,
	ih_stage_count: 1,
	ih_stage_1_set_state: "immersion.stage1",
	ih_stage_1_enabled: true,
	ih_stage_1_nominal_power_w: 2000,
	ih_buffer_temp_c_enabled: true,
	ih_buffer_temp_c_target: "buffer.temp",
	ih_planning_min_temp_c: 48,
	ih_planning_max_temp_c: 60,
	ih_force_default_stage: 1,
};

const LEGACY_PLANNER_STAGE = 3;
const LEGACY_PLANNER_TARGET_TEMP_C = 5;

function allocationEntry(slotStartIso: string, slotEndIso: string, allocatedPowerW: number): DailyAllocationEntry {
	return {
		contributionId: CONTRIBUTION_IDS.IMMERSION_MANDATORY,
		contributor: addonContributorRef("immersion_heater"),
		slot: { startIso: slotStartIso, endIso: slotEndIso },
		status: "allocated",
		energySource: "pv_surplus",
		requestedPowerW: allocatedPowerW,
		allocatedPowerW,
		requestedEnergyKwh: null,
		allocatedEnergyKwh: null,
		gridPowerW: 0,
		pvPowerW: allocatedPowerW,
		mandatory: true,
		priorityRank: 1,
		deadlineIso: null,
		estimatedCostCt: null,
		reasonDe: "test",
	};
}

/**
 * Alle Methoden sind Arrow-Function-Properties (nicht Prototype-Methoden), weil
 * `engine.ts` sie teils entbunden aufruft (`const reader = host.getForeignStateAsync ??
 * host.getStateAsync; await reader(id)`) — Prototype-Methoden würden dabei `this` verlieren.
 */
class FakeHost implements ImmersionRuntimeHost {
	config: unknown = CONFIG;
	log = { info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined };
	private states = new Map<string, ioBroker.State>();

	set = (id: string, val: ioBroker.StateValue): void => {
		this.states.set(id, { val, ack: true, ts: Date.now(), lc: Date.now(), from: "test", q: 0 } as ioBroker.State);
	};

	setObjectNotExistsAsync = async (): Promise<unknown> => {
		return undefined;
	};
	getStateAsync = async (id: string): Promise<ioBroker.State | null | undefined> => {
		return this.states.get(id) ?? null;
	};
	getForeignStateAsync = async (id: string): Promise<ioBroker.State | null | undefined> => {
		return this.states.get(id) ?? null;
	};
	setStateAsync = async (id: string, state: ioBroker.SettableState): Promise<unknown> => {
		const val = state && typeof state === "object" && "val" in state ? (state as { val: ioBroker.StateValue }).val : null;
		this.set(id, val ?? null);
		return undefined;
	};
	setForeignStateAsync = async (id: string, state: ioBroker.SettableState): Promise<unknown> => {
		return this.setStateAsync(id, state);
	};
	subscribeStatesAsync = async (): Promise<void> => {};
	subscribeForeignStatesAsync = async (): Promise<void> => {};
	unsubscribeStatesAsync = async (): Promise<void> => {};
	unsubscribeForeignStatesAsync = async (): Promise<void> => {};
}

function baseHost(bufferTempC: number): FakeHost {
	const host = new FakeHost();
	host.set(addonEnabled("immersion_heater"), true);
	host.set(addonAvailable("immersion_heater"), true);
	host.set("buffer.temp", bufferTempC);
	// Auslaufender Realtime-Planner (Legacy) — engine.ts darf diese Werte seit Block 3.1 nicht
	// mehr lesen. Absichtlich auf Werte gesetzt, die ein anderes Ergebnis erzeugen würden,
	// falls sie doch (fälschlich) gelesen würden.
	host.set("planner.intent.thermal.commanded_stage", LEGACY_PLANNER_STAGE);
	host.set("planner.intent.thermal.target_temp_c", LEGACY_PLANNER_TARGET_TEMP_C);
	return host;
}

async function decisionState(host: FakeHost, id: string): Promise<unknown> {
	const st = await host.getStateAsync(id);
	return st?.val;
}

describe("immersion runtime engine — Daily Plan vs. Sicherheits-Default (Roadmap Block 3.1)", () => {
	beforeEach(() => {
		resetImmersionRuntimeForTest();
	});

	it("daily_plan_missing: kein Daily Plan initialisiert -> lokaler Sicherheits-Default, Legacy-Planner ignoriert", async () => {
		const host = baseHost(40); // unter planningMinTempC (48) -> Heizen erwartet
		host.set(DAILY_PLAN_STATE_IDS.status, "");

		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_missing");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.decisionSource), "thermal_fallback");
		// Sicherheits-Default: ih_force_default_stage (1), NICHT der Legacy-Wert (3).
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 1);
		assert.notEqual(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), LEGACY_PLANNER_STAGE);
	});

	it("daily_plan_expired: abgelaufener Plan -> lokaler Sicherheits-Default, Legacy-Planner ignoriert", async () => {
		const now = realNow();
		const host = baseHost(40);
		host.set(DAILY_PLAN_STATE_IDS.status, "ready");
		host.set(DAILY_PLAN_STATE_IDS.date, localDateKeyInTimezone(now, TZ));
		host.set(DAILY_PLAN_STATE_IDS.revision, 1);
		host.set(DAILY_PLAN_STATE_IDS.validUntil, "2020-01-01T00:00:00.000Z");

		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_expired");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.decisionSource), "thermal_fallback");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 1);
	});

	it("daily_plan_zero_allocation (gültiger Plan, 0 W im Slot) -> Plan aus, kein Sicherheits-Default-Heizen", async () => {
		const now = realNow();
		// Unter planningMinTempC — früher hätte der Fallback geheizt; mit Plan-Ownership bleibt aus.
		const host = baseHost(40);
		host.set(DAILY_PLAN_STATE_IDS.status, "degraded");
		host.set(DAILY_PLAN_STATE_IDS.date, localDateKeyInTimezone(now, TZ));
		host.set(DAILY_PLAN_STATE_IDS.revision, 1);
		host.set(DAILY_PLAN_STATE_IDS.validUntil, "");
		host.set(ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, "[]");

		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_zero_allocation");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.decisionSource), "daily_plan");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 0);
	});

	it("Mikro-Allocation unter kleinster Stufe -> Daily Plan aus (Stage 0)", async () => {
		const now = realNow();
		const slotStartIso = slotStartIsoFloored(now, TZ);
		const slotEndIso = new Date(Date.parse(slotStartIso) + DAILY_PLAN_SLOT_MS).toISOString();
		const host = baseHost(40);
		host.set(DAILY_PLAN_STATE_IDS.status, "ready");
		host.set(DAILY_PLAN_STATE_IDS.date, localDateKeyInTimezone(now, TZ));
		host.set(DAILY_PLAN_STATE_IDS.revision, 1);
		host.set(DAILY_PLAN_STATE_IDS.validUntil, "");
		host.set(
			ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson,
			JSON.stringify([allocationEntry(slotStartIso, slotEndIso, 8)]),
		);

		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_zero_allocation");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.decisionSource), "daily_plan");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 0);
	});

	it("daily_plan_valid: Allocation im aktuellen Slot -> Daily Plan steuert, Legacy-Planner bleibt irrelevant", async () => {
		const now = realNow();
		const slotStartIso = slotStartIsoFloored(now, TZ);
		const slotEndIso = new Date(Date.parse(slotStartIso) + DAILY_PLAN_SLOT_MS).toISOString();
		const host = baseHost(40);
		host.set(DAILY_PLAN_STATE_IDS.status, "ready");
		host.set(DAILY_PLAN_STATE_IDS.date, localDateKeyInTimezone(now, TZ));
		host.set(DAILY_PLAN_STATE_IDS.revision, 1);
		host.set(DAILY_PLAN_STATE_IDS.validUntil, "");
		host.set(
			ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson,
			JSON.stringify([allocationEntry(slotStartIso, slotEndIso, 2000)]),
		);

		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_valid");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.decisionSource), "daily_plan");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 1);
		assert.notEqual(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), LEGACY_PLANNER_STAGE);
	});

	it("Sicherheits-Default heizt nur bis planningMinTempC, nicht bis planningMaxTempC (Pflicht-Untergrenze, kein Komfortziel)", async () => {
		// Puffer bereits über der Pflicht-Untergrenze (48), aber unter der Komfort-Obergrenze (60):
		// der Sicherheits-Default darf hier NICHT weiterheizen.
		const host = baseHost(50);
		host.set(DAILY_PLAN_STATE_IDS.status, "");

		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 0);
		assert.equal(getImmersionPersistForTest().commandedStage, 0);
	});
});

describe("immersion runtime — BETA-GATE-003 effective live reconcile", () => {
	beforeEach(() => {
		resetImmersionRuntimeForTest();
	});

	function seedStage1Plan(host: FakeHost): { slotStartIso: string; slotEndIso: string } {
		const now = realNow();
		const slotStartIso = slotStartIsoFloored(now, TZ);
		const slotEndIso = new Date(Date.parse(slotStartIso) + DAILY_PLAN_SLOT_MS).toISOString();
		host.set("addons.immersion_heater.governance.enabled", true);
		host.set("immersion.stage1", false);
		host.set(DAILY_PLAN_STATE_IDS.status, "ready");
		host.set(DAILY_PLAN_STATE_IDS.date, localDateKeyInTimezone(now, TZ));
		host.set(DAILY_PLAN_STATE_IDS.revision, 1);
		host.set(DAILY_PLAN_STATE_IDS.validUntil, "");
		host.set(
			ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson,
			JSON.stringify([allocationEntry(slotStartIso, slotEndIso, 2000)]),
		);
		return { slotStartIso, slotEndIso };
	}

	function trackWrites(host: FakeHost): Array<{ id: string; val: unknown }> {
		const foreignWrites: Array<{ id: string; val: unknown }> = [];
		const origSetForeign = host.setForeignStateAsync;
		host.setForeignStateAsync = async (id, state) => {
			const val =
				state && typeof state === "object" && "val" in state
					? (state as { val: unknown }).val
					: state;
			foreignWrites.push({ id, val });
			return origSetForeign(id, state);
		};
		return foreignWrites;
	}

	it("global edge: global dryrun→live with IH already live reconciles once", async () => {
		const host = baseHost(40);
		host.set("global.execution_mode", "dryrun");
		host.set("addons.immersion_heater.mode", "live");
		seedStage1Plan(host);
		const foreignWrites = trackWrites(host);

		await runImmersionRuntimeTick(host);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 1);
		assert.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);

		host.set("global.execution_mode", "live");
		await runImmersionRuntimeTick(host);
		const liveWrites = foreignWrites.filter((w) => w.id === "immersion.stage1");
		assert.equal(liveWrites.length, 1);
		assert.equal(liveWrites[0]!.val, true);

		const beforeSecond = foreignWrites.length;
		await runImmersionRuntimeTick(host);
		assert.equal(foreignWrites.length, beforeSecond);
	});

	it("addon edge: IH dryrun→live with global already live reconciles once", async () => {
		const host = baseHost(40);
		host.set("global.execution_mode", "live");
		host.set("addons.immersion_heater.mode", "dryrun");
		seedStage1Plan(host);
		const foreignWrites = trackWrites(host);

		await runImmersionRuntimeTick(host);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 1);
		assert.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);

		host.set("addons.immersion_heater.mode", "live");
		await runImmersionRuntimeTick(host);
		const liveWrites = foreignWrites.filter((w) => w.id === "immersion.stage1");
		assert.equal(liveWrites.length, 1);
		assert.equal(liveWrites[0]!.val, true);
	});

	it("live→dryrun (global) blocks subsequent hardware writes", async () => {
		const host = baseHost(40);
		host.set("global.execution_mode", "live");
		host.set("addons.immersion_heater.mode", "live");
		const { slotStartIso, slotEndIso } = seedStage1Plan(host);
		const foreignWrites = trackWrites(host);

		await runImmersionRuntimeTick(host);
		assert.ok(foreignWrites.some((w) => w.id === "immersion.stage1" && w.val === true));

		host.set("global.execution_mode", "dryrun");
		host.set(
			ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson,
			JSON.stringify([allocationEntry(slotStartIso, slotEndIso, 0)]),
		);
		const n = foreignWrites.length;
		await runImmersionRuntimeTick(host);
		assert.equal(foreignWrites.length, n, "global dryrun must block further writes");
	});
});
