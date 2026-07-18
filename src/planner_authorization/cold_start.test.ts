import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	ensurePlannerAuthorizationStates,
	PLANNER_AUTHORIZATION_STATE_IDS,
} from "./states.js";
import { initPlannerAuthorizationRuntime, stopPlannerAuthorizationRuntime } from "./runtime.js";
import { resetAuthorizationSessionForTest } from "./runtime_session.js";

function memoryHost(config: Record<string, unknown> = {}) {
	const objects = new Map<string, unknown>();
	const states = new Map<string, unknown>();
	const order: string[] = [];
	return {
		namespace: "ems.0",
		config,
		log: { debug() {}, info() {}, warn() {}, error() {} },
		objects,
		states,
		order,
		async setObjectNotExistsAsync(id: string, obj: unknown) {
			order.push(`object:${id}`);
			if (!objects.has(id)) objects.set(id, obj);
		},
		async getStateAsync(id: string) {
			return states.has(id) ? { val: states.get(id), ack: true } : null;
		},
		async setStateAsync(id: string, st: { val?: unknown } | unknown) {
			order.push(`state:${id}`);
			const v = st && typeof st === "object" && st !== null && "val" in st ? (st as { val: unknown }).val : st;
			states.set(id, v);
		},
		async extendObjectAsync() {},
		async subscribeStatesAsync() {},
		async unsubscribeStatesAsync() {},
	};
}

describe("planner_authorization cold start", () => {
	it("creates authorization objects before the first state write", async () => {
		resetAuthorizationSessionForTest();
		const host = memoryHost({ planner_takeover_authorization_mode: "disabled" });
		await initPlannerAuthorizationRuntime(host as never);
		const firstObject = host.order.findIndex((e) => e.startsWith("object:"));
		const firstState = host.order.findIndex((e) => e.startsWith("state:"));
		assert.ok(firstObject >= 0, "expected object ensure");
		assert.ok(firstState >= 0, "expected state write");
		assert.ok(firstObject < firstState, "objects must be ensured before state writes");
		assert.ok(host.objects.has(PLANNER_AUTHORIZATION_STATE_IDS.configuredMode));
		await stopPlannerAuthorizationRuntime();
	});

	it("ensurePlannerAuthorizationStates is idempotent", async () => {
		const host = memoryHost();
		await ensurePlannerAuthorizationStates(host as never);
		await ensurePlannerAuthorizationStates(host as never);
		assert.ok(host.objects.has(PLANNER_AUTHORIZATION_STATE_IDS.blockReasonCount));
	});
});
