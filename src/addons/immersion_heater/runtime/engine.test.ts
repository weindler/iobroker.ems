import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
	runImmersionRuntimeTick,
	resetImmersionRuntimeForTest,
	getImmersionPersistForTest,
	getImmersionLastCommandedStageForTest,
	getImmersionEmsOnWriteAtMsForTest,
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
import { checkPowerFault } from "./safety.js";
import { immersionDeviceConfigFromAdapter } from "../device_config.js";
import { resetRestoreBarrierForTest, setRestoreInProgress } from "../../../restore/barrier.js";
import { IMMERSION_MANUAL_OVERRIDE_DURATION_MS_DEFAULT } from "./feedback.js";

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
	ih_boiler_temp_c_enabled: true,
	ih_boiler_temp_c_target: "boiler.temp",
	ih_boiler_min_temp_c: 50,
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
	log: ImmersionRuntimeHost["log"] = {
		info: () => undefined,
		warn: () => undefined,
		debug: () => undefined,
		error: () => undefined,
	};
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

function baseHost(bufferTempC: number, boilerTempC = 58): FakeHost {
	const host = new FakeHost();
	host.set(addonEnabled("immersion_heater"), true);
	host.set(addonAvailable("immersion_heater"), true);
	host.set("buffer.temp", bufferTempC);
	host.set("boiler.temp", boilerTempC);
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

	it("daily_plan_missing: kalter Puffer + warmer Boiler → kein Hard-Heizen nur wegen Puffer", async () => {
		const host = baseHost(40, 58);
		host.set(DAILY_PLAN_STATE_IDS.status, "");

		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_missing");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.decisionSource), "thermal_fallback");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 0);
		assert.notEqual(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), LEGACY_PLANNER_STAGE);
	});

	it("daily_plan_missing: Boiler unter Min → ohne Plan kein lokales Heizen", async () => {
		const host = baseHost(40, 48);
		host.set(DAILY_PLAN_STATE_IDS.status, "");

		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.decisionSource), "thermal_fallback");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 0);
		assert.notEqual(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), LEGACY_PLANNER_STAGE);
	});

	it("daily_plan_expired: Boiler unter Min → ohne Plan kein lokales Heizen", async () => {
		const now = realNow();
		const host = baseHost(40, 48);
		host.set(DAILY_PLAN_STATE_IDS.status, "ready");
		host.set(DAILY_PLAN_STATE_IDS.date, localDateKeyInTimezone(now, TZ));
		host.set(DAILY_PLAN_STATE_IDS.revision, 1);
		host.set(DAILY_PLAN_STATE_IDS.validUntil, "2020-01-01T00:00:00.000Z");

		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_expired");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.decisionSource), "thermal_fallback");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 0);
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

	it("Sicherheits-Default: Boiler über Min → kein Fallback-Heizen trotz Puffer unter Max", async () => {
		const host = baseHost(50, 58);
		host.set(DAILY_PLAN_STATE_IDS.status, "");

		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 0);
		assert.equal(getImmersionPersistForTest().commandedStage, 0);
	});
	it("Admin Mindestpause (ih_minimum_pause_sec) bleibt nach Aus-Schalt erhalten", async () => {
		const now = realNow();
		const slotStartIso = slotStartIsoFloored(now, TZ);
		const slotEndIso = new Date(Date.parse(slotStartIso) + DAILY_PLAN_SLOT_MS).toISOString();
		const host = baseHost(40);
		host.config = {
			...CONFIG,
			ih_minimum_runtime_sec: 1,
			ih_minimum_pause_sec: 600,
		};
		host.set("global.execution_mode", "live");
		host.set("addons.immersion_heater.mode", "live");
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

		await runImmersionRuntimeTick(host);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 1);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.configMinimumPauseSec), 600);

		// Mindestlaufzeit ablaufen lassen, damit Plan-OFF die Pause setzt (nicht weiter hält).
		getImmersionPersistForTest().minRuntimeUntilMs = Date.now() - 1;
		host.set(ALLOCATION_ADDON_STATE_IDS.immersion_heater.status, "ready");
		host.set(ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, "[]");
		await runImmersionRuntimeTick(host);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 0);
		const pauseUntil = getImmersionPersistForTest().pauseUntilMs;
		assert.ok(pauseUntil != null, "pauseUntilMs gesetzt");
		const remSec = Math.ceil((pauseUntil! - Date.now()) / 1000);
		assert.ok(remSec >= 590 && remSec <= 600, `Admin-Pause ~600s erwartet, got ${remSec}`);
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

describe("immersion runtime — Root Cause A write apply confirmation", () => {
	beforeEach(() => {
		resetImmersionRuntimeForTest();
		resetRestoreBarrierForTest();
	});

	function seedLiveStage1(host: FakeHost): void {
		const now = realNow();
		const slotStartIso = slotStartIsoFloored(now, TZ);
		const slotEndIso = new Date(Date.parse(slotStartIso) + DAILY_PLAN_SLOT_MS).toISOString();
		host.set("global.execution_mode", "live");
		host.set("addons.immersion_heater.mode", "live");
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

	it("A) governance blocked → no write, no apply markers; later retry when allowed", async () => {
		const host = baseHost(40);
		seedLiveStage1(host);
		host.set("addons.immersion_heater.governance.enabled", false);
		const foreignWrites = trackWrites(host);

		await runImmersionRuntimeTick(host);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 1);
		assert.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);
		assert.equal(getImmersionLastCommandedStageForTest(), -1);
		assert.equal(getImmersionEmsOnWriteAtMsForTest(), null);

		host.set("addons.immersion_heater.governance.enabled", true);
		await runImmersionRuntimeTick(host);
		const onWrites = foreignWrites.filter((w) => w.id === "immersion.stage1" && w.val === true);
		assert.equal(onWrites.length, 1);
		assert.equal(getImmersionLastCommandedStageForTest(), 1);
		assert.ok(getImmersionEmsOnWriteAtMsForTest() !== null);
	});

	it("B) restore blocked → no apply markers", async () => {
		const host = baseHost(40);
		seedLiveStage1(host);
		const foreignWrites = trackWrites(host);
		setRestoreInProgress(true);
		try {
			await runImmersionRuntimeTick(host);
			assert.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);
			assert.equal(getImmersionLastCommandedStageForTest(), -1);
			assert.equal(getImmersionEmsOnWriteAtMsForTest(), null);
		} finally {
			resetRestoreBarrierForTest();
		}
	});

	it("C) skip without confirmed readback → not applied; next tick retries write", async () => {
		const host = baseHost(40);
		seedLiveStage1(host);
		const foreignWrites = trackWrites(host);
		let stageReads = 0;
		const origGetForeign = host.getForeignStateAsync;
		host.getForeignStateAsync = async (id) => {
			if (id === "immersion.stage1") {
				stageReads += 1;
				// 1st read (write helper): pretend already ON → skip; 2nd (readback): OFF → reject
				const val = stageReads === 1;
				return { val, ack: true, ts: Date.now(), lc: Date.now(), from: "test", q: 0 } as ioBroker.State;
			}
			return origGetForeign(id);
		};

		await runImmersionRuntimeTick(host);
		assert.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);
		assert.equal(getImmersionLastCommandedStageForTest(), -1);
		assert.equal(getImmersionEmsOnWriteAtMsForTest(), null);

		// Stable OFF → next tick must write ON
		host.getForeignStateAsync = origGetForeign;
		host.set("immersion.stage1", false);
		await runImmersionRuntimeTick(host);
		assert.ok(foreignWrites.some((w) => w.id === "immersion.stage1" && w.val === true));
		assert.equal(getImmersionLastCommandedStageForTest(), 1);
		assert.ok(getImmersionEmsOnWriteAtMsForTest() !== null);
	});

	it("D) skip with readback already ON → accept as applied without new write", async () => {
		const host = baseHost(40);
		seedLiveStage1(host);
		host.set("immersion.stage1", true);
		const foreignWrites = trackWrites(host);

		await runImmersionRuntimeTick(host);
		assert.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);
		assert.equal(getImmersionLastCommandedStageForTest(), 1);
		assert.ok(getImmersionEmsOnWriteAtMsForTest() !== null);
	});

	it("E) successful ON write → lastCommandedStage=1 and emsOnWriteAtMs set", async () => {
		const host = baseHost(40);
		seedLiveStage1(host);
		const foreignWrites = trackWrites(host);

		await runImmersionRuntimeTick(host);
		assert.ok(foreignWrites.some((w) => w.id === "immersion.stage1" && w.val === true));
		assert.equal(getImmersionLastCommandedStageForTest(), 1);
		assert.ok(getImmersionEmsOnWriteAtMsForTest() !== null);
	});

	it("F) write error → write_failed lockout unchanged", async () => {
		const host = baseHost(40);
		seedLiveStage1(host);
		host.setForeignStateAsync = async () => {
			throw new Error("bus offline");
		};

		await runImmersionRuntimeTick(host);
		assert.equal(getImmersionPersistForTest().faultCode, "write_failed");
		assert.equal(getImmersionPersistForTest().faultLockout, true);
		assert.equal(getImmersionLastCommandedStageForTest(), -1);
		assert.equal(getImmersionEmsOnWriteAtMsForTest(), null);
	});

	it("G) successful ON write + fresh measured 0 → no_power_when_on still locks", async () => {
		const host = baseHost(40);
		seedLiveStage1(host);
		host.config = {
			...CONFIG,
			ih_actual_power_state: "immersion.power",
			ih_switch_on_check_delay_sec: 1,
		};
		host.set("immersion.power", 0);

		await runImmersionRuntimeTick(host);
		assert.equal(getImmersionLastCommandedStageForTest(), 1);
		const onAt = getImmersionEmsOnWriteAtMsForTest();
		assert.ok(onAt !== null);

		// Safety-Pfad unverändert: nach Delay + frischem 0-W-Sample → Lockout
		const cfg = immersionDeviceConfigFromAdapter(host.config);
		const fault = checkPowerFault({
			nowMs: (onAt as number) + 5_000,
			executionLive: true,
			commandedOn: true,
			commandedStage: 1,
			nominalPowerW: 2000,
			measuredPowerW: 0,
			hasPowerMeasurement: true,
			feedbackActive: false,
			emsOnWriteAtMs: onAt,
			emsOffWriteAtMs: null,
			powerObservedAtMs: (onAt as number) + 1_000,
			mismatchSinceMs: null,
			config: cfg,
		});
		assert.equal(fault.faultCode, "no_power_when_on");
		assert.equal(fault.lockout, true);
	});
});

describe("immersion runtime — Klima-/Ownership-Block: Manual Override", () => {
	beforeEach(() => {
		resetImmersionRuntimeForTest();
	});

	function liveHostNoDemand(): FakeHost {
		// Warmer Puffer/Boiler + kein Daily Plan → EMS will Stufe 0 (kein Heizbedarf).
		const host = baseHost(58, 58);
		host.set("global.execution_mode", "live");
		host.set("addons.immersion_heater.mode", "live");
		host.set("addons.immersion_heater.governance.enabled", true);
		host.set(DAILY_PLAN_STATE_IDS.status, "");
		// Feedback = dieselbe State-ID wie set_state (kombiniertes Relais mit Rückmeldung).
		host.config = { ...CONFIG, ih_stage_1_feedback_state: "immersion.stage1" };
		host.set("immersion.stage1", false);
		return host;
	}

	function trackForeignWrites(host: FakeHost): Array<{ id: string; val: unknown }> {
		const writes: Array<{ id: string; val: unknown }> = [];
		const orig = host.setForeignStateAsync;
		host.setForeignStateAsync = async (id, state) => {
			const val = state && typeof state === "object" && "val" in state ? (state as { val: unknown }).val : state;
			writes.push({ id, val });
			return orig(id, state);
		};
		return writes;
	}

	it("manueller Heizstab-Eingriff (Relais manuell EIN) → EMS respektiert Override, kein sofortiges Zurückschalten", async () => {
		const host = liveHostNoDemand();

		// Takt 1: Baseline — EMS will 0, Relais startet false → kein Mismatch, kein Override.
		await runImmersionRuntimeTick(host);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 0);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");
		// Settle-Fenster (IMMERSION_OWNERSHIP_SETTLE_MS) simuliert verstrichen — sonst blockiert
		// der Eigen-Write-Schutz aus Takt 1 die Erkennung in den folgenden (im Test sehr schnellen) Takten.
		getImmersionPersistForTest().lastOffAtMs = Date.now() - 5 * 60_000;
		getImmersionPersistForTest().lastSwitchAtMs = Date.now() - 5 * 60_000;

		// Manueller Eingriff zwischen den Takten: Relais wird von Hand eingeschaltet.
		host.set("immersion.stage1", true);
		await runImmersionRuntimeTick(host); // Takt 2: Mismatch wird erkannt (Erkennung mit 1 Takt Verzögerung)

		const writes = trackForeignWrites(host);
		await runImmersionRuntimeTick(host); // Takt 3: Override sollte jetzt aktiv sein

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
		assert.ok(
			(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso)) !== "",
			"Override-Frist muss gesetzt sein",
		);
		// EMS darf das manuell eingeschaltete Relais während des Overrides NICHT zurückschalten.
		assert.equal(
			writes.some((w) => w.id === "immersion.stage1"),
			false,
			"EMS darf während Manual-Override nicht auf das Relais schreiben",
		);
	});

	it("Safety/kritischer Zustand (Fault-Lockout) übersteuert einen aktiven Manual Override", async () => {
		const host = liveHostNoDemand();
		await runImmersionRuntimeTick(host);
		getImmersionPersistForTest().lastOffAtMs = Date.now() - 5 * 60_000;
		getImmersionPersistForTest().lastSwitchAtMs = Date.now() - 5 * 60_000;
		host.set("immersion.stage1", true);
		await runImmersionRuntimeTick(host);
		await runImmersionRuntimeTick(host);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "user");

		// Fault-Lockout auslösen (Safety) — muss den Override sofort beenden.
		getImmersionPersistForTest().faultLockout = true;
		getImmersionPersistForTest().faultCode = "relay_chatter";
		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso), "");
	});

	function expireSettle(): void {
		getImmersionPersistForTest().lastOffAtMs = Date.now() - 5 * 60_000;
		getImmersionPersistForTest().lastSwitchAtMs = Date.now() - 5 * 60_000;
	}

	function captureInfo(host: FakeHost): string[] {
		const lines: string[] = [];
		host.log.info = (msg: string) => {
			lines.push(msg);
		};
		return lines;
	}

	function liveHostNoDemandSplitFeedback(): FakeHost {
		const host = liveHostNoDemand();
		host.config = { ...CONFIG, ih_stage_1_feedback_state: "immersion.fb" };
		host.set("immersion.stage1", false);
		host.set("immersion.fb", false);
		return host;
	}

	async function reachManualOnOverride(host: FakeHost, feedbackId = "immersion.stage1"): Promise<void> {
		await runImmersionRuntimeTick(host);
		expireSettle();
		host.set("immersion.stage1", true);
		if (feedbackId !== "immersion.stage1") host.set(feedbackId, true);
		await runImmersionRuntimeTick(host);
		await runImmersionRuntimeTick(host);
	}

	it("extern OFF→ON: genau ein Override, paused_until = now + konfigurierte Dauer", async () => {
		const host = liveHostNoDemand();
		await reachManualOnOverride(host);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
		const untilIso = String(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso));
		const delta = Date.parse(untilIso) - Date.now();
		assert.ok(
			delta > IMMERSION_MANUAL_OVERRIDE_DURATION_MS_DEFAULT - 15_000,
			`paused_until zu früh: delta=${delta}`,
		);
		assert.ok(
			delta <= IMMERSION_MANUAL_OVERRIDE_DURATION_MS_DEFAULT + 5_000,
			`paused_until zu weit: delta=${delta}`,
		);
	});

	it("100 Polls mit unverändertem ON verlängern paused_until nicht", async () => {
		const host = liveHostNoDemand();
		await reachManualOnOverride(host);
		const untilIso = await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso);
		for (let i = 0; i < 100; i++) {
			await runImmersionRuntimeTick(host);
			assert.equal(
				await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso),
				untilIso,
				`Poll ${i + 1}: paused_until darf nicht wandern`,
			);
			assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
		}
	});

	it("EMS selbst schaltet ON → kein Manual Override", async () => {
		const now = realNow();
		const slotStartIso = slotStartIsoFloored(now, TZ);
		const slotEndIso = new Date(Date.parse(slotStartIso) + DAILY_PLAN_SLOT_MS).toISOString();
		const host = baseHost(40);
		host.config = { ...CONFIG, ih_stage_1_feedback_state: "immersion.stage1" };
		host.set("global.execution_mode", "live");
		host.set("addons.immersion_heater.mode", "live");
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

		await runImmersionRuntimeTick(host);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 1);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");

		expireSettle();
		for (let i = 0; i < 5; i++) {
			await runImmersionRuntimeTick(host);
			assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");
			assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso), "");
		}
	});

	it("Override aktiv, Planner will OFF: Write blockiert, Timer unverändert", async () => {
		const host = liveHostNoDemand();
		await reachManualOnOverride(host);
		const untilIso = await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.commandedStage), 0);

		const writes = trackForeignWrites(host);
		await runImmersionRuntimeTick(host);
		assert.equal(
			writes.some((w) => w.id === "immersion.stage1"),
			false,
			"EMS-Write bleibt bis Ablauf blockiert",
		);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso), untilIso);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
	});

	it("Override läuft ab, Feedback noch ON → kein Sofort-Retrigger, EMS übernimmt", async () => {
		const host = liveHostNoDemandSplitFeedback();
		await reachManualOnOverride(host, "immersion.fb");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "user");

		getImmersionPersistForTest().ownership = {
			...getImmersionPersistForTest().ownership,
			overrideUntilIso: new Date(Date.now() - 1000).toISOString(),
		};

		const writes = trackForeignWrites(host);
		await runImmersionRuntimeTick(host);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso), "");
		assert.ok(
			writes.some((w) => w.id === "immersion.stage1"),
			"EMS darf nach Ablauf wieder schreiben",
		);

		expireSettle();
		host.set("immersion.fb", true);
		for (let i = 0; i < 5; i++) {
			await runImmersionRuntimeTick(host);
			assert.equal(
				await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner),
				"ems",
				`Poll ${i + 1} nach Ablauf: kein neuer Override nur wegen gehaltenem ON`,
			);
		}
	});

	it("echtes neues manuelles OFF→ON nach Ablauf startet neuen Override", async () => {
		const host = liveHostNoDemandSplitFeedback();
		await reachManualOnOverride(host, "immersion.fb");
		getImmersionPersistForTest().ownership = {
			...getImmersionPersistForTest().ownership,
			overrideUntilIso: new Date(Date.now() - 1000).toISOString(),
		};
		await runImmersionRuntimeTick(host);
		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");

		expireSettle();
		host.set("immersion.fb", false);
		await runImmersionRuntimeTick(host);
		host.set("immersion.fb", true);
		await runImmersionRuntimeTick(host);
		await runImmersionRuntimeTick(host);

		assert.equal(await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
		assert.ok((await decisionState(host, IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso)) !== "");
	});

	it("identischer aktiver Override erzeugt keinen Info-Log-Spam", async () => {
		const host = liveHostNoDemand();
		const info = captureInfo(host);
		await reachManualOnOverride(host);
		const detected = info.filter((l) => l.includes("manual override detected"));
		assert.equal(detected.length, 1, "genau eine Detected-Zeile");
		assert.equal(
			info.filter((l) => l.includes("manual override active")).length,
			0,
			"kein altes Active-Spam-Log",
		);

		const before = info.length;
		for (let i = 0; i < 20; i++) {
			await runImmersionRuntimeTick(host);
		}
		const added = info.slice(before);
		assert.equal(
			added.filter((l) => l.includes("manual override")).length,
			0,
			"kein Override-Info bei unverändertem Override",
		);
	});
});
