import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	buildAddonRuntimeSurfaceSnapshot,
	ensureAddonRuntimeSurfaceStates,
	mapDecisionDetailToCanonical,
	plannerStatusFromDailyPlan,
	publishAddonRuntimeSurface,
	runtimeSurfaceStateMap,
} from "./index.js";
import { GOVERNED_ADDON_REGISTRY } from "../governance/registry.js";

type MemState = { val: ioBroker.StateValue; ack: boolean };

function mockHost(initial: Record<string, MemState> = {}) {
	const objects = new Set<string>();
	const states = new Map<string, MemState>(Object.entries(initial));
	return {
		objects,
		states,
		host: {
			setObjectNotExistsAsync: async (id: string) => {
				objects.add(id);
			},
			getStateAsync: async (id: string) => states.get(id) ?? null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				states.set(id, { val: st.val as ioBroker.StateValue, ack: st.ack === true });
			},
		},
	};
}

describe("runtime_surface mapDecisionDetailToCanonical", () => {
	it("maps daily_plan family to deterministic_planner", () => {
		assert.equal(mapDecisionDetailToCanonical("daily_plan"), "deterministic_planner");
		assert.equal(mapDecisionDetailToCanonical("daily_plan_zero"), "deterministic_planner");
		assert.equal(mapDecisionDetailToCanonical("daily_plan_passive_pv"), "deterministic_planner");
	});

	it("maps off / manual / fallbacks / safety", () => {
		assert.equal(mapDecisionDetailToCanonical("governance_disabled"), "off");
		assert.equal(mapDecisionDetailToCanonical("manual_force"), "manual");
		assert.equal(mapDecisionDetailToCanonical("thermal_fallback"), "policy_fallback");
		assert.equal(mapDecisionDetailToCanonical("climate_fallback"), "policy_fallback");
		assert.equal(mapDecisionDetailToCanonical("fault"), "safety");
		assert.equal(mapDecisionDetailToCanonical("missing_telemetry"), "safety");
		assert.equal(mapDecisionDetailToCanonical("ai"), "ai");
	});

	it("unknown detail → safety (no fake planner)", () => {
		assert.equal(mapDecisionDetailToCanonical("something_weird"), "safety");
		assert.equal(mapDecisionDetailToCanonical(""), "safety");
	});
});

describe("runtime_surface plannerStatusFromDailyPlan", () => {
	it("off when governance or addon disabled", () => {
		assert.equal(
			plannerStatusFromDailyPlan({ governanceEnabled: false, dailyPlanStatus: "valid" }),
			"off",
		);
		assert.equal(
			plannerStatusFromDailyPlan({
				governanceEnabled: true,
				addonEnabled: false,
				useDailyPlan: true,
			}),
			"off",
		);
	});

	it("valid when useDailyPlan", () => {
		assert.equal(
			plannerStatusFromDailyPlan({
				governanceEnabled: true,
				useDailyPlan: true,
				dailyPlanStatus: "daily_plan_missing",
			}),
			"valid",
		);
	});

	it("missing / invalid from status string", () => {
		assert.equal(
			plannerStatusFromDailyPlan({
				governanceEnabled: true,
				dailyPlanStatus: "daily_plan_missing",
			}),
			"missing",
		);
		assert.equal(
			plannerStatusFromDailyPlan({
				governanceEnabled: true,
				dailyPlanStatus: "invalid_plan",
			}),
			"invalid",
		);
	});
});

describe("runtime_surface ensure + publish", () => {
	it("ensures surface states for all governed runtime ids", async () => {
		const mock = mockHost();
		await ensureAddonRuntimeSurfaceStates(mock.host as import("../../ems_light/state_util.js").StateHost);
		for (const entry of GOVERNED_ADDON_REGISTRY) {
			const ids = runtimeSurfaceStateMap(entry.runtimeAddonId);
			assert.ok(mock.objects.has(ids.decisionSource), entry.runtimeAddonId);
			assert.ok(mock.objects.has(ids.plannerStatus), entry.runtimeAddonId);
			assert.ok(mock.objects.has(ids.fault), entry.runtimeAddonId);
		}
		assert.ok(mock.objects.has("addons.air_conditioning.runtime.surface.decision_source"));
	});

	it("publishes canonical surface and only writes on change", async () => {
		const mock = mockHost();
		await ensureAddonRuntimeSurfaceStates(mock.host as import("../../ems_light/state_util.js").StateHost);
		let writes = 0;
		const countingHost = {
			...mock.host,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				writes++;
				return mock.host.setStateAsync(id, st);
			},
		} as import("../../ems_light/state_util.js").StateHost;
		const input = {
			decisionDetail: "daily_plan",
			decisionReason: "Slot aktiv",
			nowIso: "2026-07-27T12:00:00.000Z",
			plannerStatus: "valid" as const,
			intentStatus: "active" as const,
			executionStatus: "dryrun" as const,
			profileReady: true,
			telemetryReady: true,
			fault: false,
			lockout: false,
		};
		const snap = await publishAddonRuntimeSurface(countingHost, "immersion_heater", input);
		assert.equal(snap.decisionSource, "deterministic_planner");
		assert.equal(snap.decisionDetail, "daily_plan");
		const ids = runtimeSurfaceStateMap("immersion_heater");
		assert.equal(mock.states.get(ids.decisionSource)?.val, "deterministic_planner");
		assert.equal(mock.states.get(ids.decisionDetail)?.val, "daily_plan");
		assert.equal(mock.states.get(ids.plannerStatus)?.val, "valid");
		assert.equal(mock.states.get(ids.lastDecisionAt)?.val, "2026-07-27T12:00:00.000Z");
		const firstWrites = writes;
		assert.ok(firstWrites >= 11);

		writes = 0;
		await publishAddonRuntimeSurface(countingHost, "immersion_heater", input);
		assert.equal(writes, 0);

		const built = buildAddonRuntimeSurfaceSnapshot({
			...input,
			decisionDetail: "manual_off",
		});
		assert.equal(built.decisionSource, "manual");
	});
});
