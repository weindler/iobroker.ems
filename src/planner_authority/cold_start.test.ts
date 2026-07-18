import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	ensurePlannerAuthorityStates,
	PLANNER_AUTHORITY_STATE_IDS,
	writePlannerAuthorityMemoryStates,
} from "./states.js";
import { initPlannerAuthorityRuntime, stopPlannerAuthorityRuntime } from "./runtime.js";
import { resetAuthoritySessionForTest } from "./runtime_session.js";
import { projectWorkerViewToIntentStates } from "./project_intent.js";
import { DAILY_PLAN_STATE_IDS } from "../operator/daily_plan/states.js";
import type { AuthoritativePlannerView } from "./types.js";

function memoryHost(config: Record<string, unknown> = {}) {
	const objects = new Map<string, unknown>();
	const states = new Map<string, { val: unknown; type?: string }>();
	const order: string[] = [];
	return {
		namespace: "ems.0",
		config,
		log: { debug() {}, info() {}, warn() {}, error() {} },
		objects,
		states,
		order,
		getAbsoluteInstanceDataDir: () => "/tmp/ems-authority-cold",
		async setObjectNotExistsAsync(id: string, obj: unknown) {
			order.push(`object:${id}`);
			if (!objects.has(id)) objects.set(id, obj);
			const common = (obj as { common?: { type?: string } } | null)?.common;
			if (common?.type) {
				states.set(id, { val: states.get(id)?.val, type: common.type });
			}
		},
		async getStateAsync(id: string) {
			const cur = states.get(id);
			return cur && cur.val !== undefined ? { val: cur.val, ack: true } : null;
		},
		async setStateAsync(id: string, st: { val?: unknown } | unknown) {
			order.push(`state:${id}`);
			const v = st && typeof st === "object" && st !== null && "val" in st ? (st as { val: unknown }).val : st;
			const prev = states.get(id);
			states.set(id, { val: v, type: prev?.type });
		},
		async extendObjectAsync() {},
		async subscribeStatesAsync() {},
		async unsubscribeStatesAsync() {},
	};
}

describe("planner_authority cold start", () => {
	it("creates authority objects before the first state write", async () => {
		resetAuthoritySessionForTest();
		const host = memoryHost({ planner_authoritative_source: "legacy" });
		await initPlannerAuthorityRuntime(host as never);
		const firstObject = host.order.findIndex((e) => e.startsWith("object:"));
		const firstState = host.order.findIndex((e) => e.startsWith("state:"));
		assert.ok(firstObject >= 0);
		assert.ok(firstState >= 0);
		assert.ok(firstObject < firstState);
		assert.ok(host.objects.has(PLANNER_AUTHORITY_STATE_IDS.configuredSource));
		await stopPlannerAuthorityRuntime();
	});

	it("writes only numbers into numeric memory and daily-plan allocation meta states", async () => {
		const host = memoryHost();
		await ensurePlannerAuthorityStates(host as never);
		await writePlannerAuthorityMemoryStates(host as never, {
			rssBeforeWorkerJobMib: 100,
			rssAfterWorkerExitMib: 120,
			lastWorkerDeltaMib: 20,
			legacyModuleLoaded: false,
		});
		assert.equal(typeof host.states.get(PLANNER_AUTHORITY_STATE_IDS.rssBeforeWorkerJobMib)?.val, "number");
		assert.equal(typeof host.states.get(PLANNER_AUTHORITY_STATE_IDS.rssAfterWorkerExitMib)?.val, "number");
		assert.equal(typeof host.states.get(PLANNER_AUTHORITY_STATE_IDS.lastWorkerDeltaMib)?.val, "number");

		const view: AuthoritativePlannerView = {
			source: "worker_dryrun",
			quality: "valid",
			generation: 3,
			planRevision: "rev-test",
			loadedAt: "2026-07-15T10:05:00.000Z",
			currentSlot: {
				slotStart: "2026-07-15T10:00:00.000Z",
				slotEnd: "2026-07-15T10:15:00.000Z",
				allocations: [
					{
						contributionId: "battery.charge",
						status: "allocated",
						powerW: 1000,
						energyKwh: 0.25,
					},
				],
			},
			nextSlot: null,
		};
		await projectWorkerViewToIntentStates(host as never, {
			view,
			now: new Date("2026-07-15T10:05:00.000Z"),
			timezone: "Europe/Berlin",
			globalMode: "balanced",
			slotMinutes: 15,
		});
		assert.equal(typeof host.states.get(DAILY_PLAN_STATE_IDS.slotMinutes)?.val, "number");
		assert.equal(typeof host.states.get(DAILY_PLAN_STATE_IDS.revision)?.val, "number");
		assert.notEqual(typeof host.states.get(DAILY_PLAN_STATE_IDS.slotMinutes)?.val, "string");
		assert.notEqual(typeof host.states.get(DAILY_PLAN_STATE_IDS.revision)?.val, "string");
	});
});
