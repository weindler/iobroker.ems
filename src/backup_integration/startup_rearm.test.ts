import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	isStartupRearmRequired,
	clearStartupRearmRequired,
	markBootstrapCompletedForRearm,
	isFreshUserStateChange,
	isExplicitUserExecutionModeRequest,
	isExplicitUserLiveRearmRequest,
	isAdapterInternalStateOrigin,
	recordExecutionModeBaseline,
	resetStartupRearmForTest,
	setStartupRearmRequired,
} from "./startup_rearm.js";
import {
	handleExecutionModeStateChange,
	isLiveWriteAllowed,
	syncExecutionModesFromConfig,
} from "../execution_mode.js";
import { GLOBAL, addonMode } from "../tree_paths.js";

const NS = "ems.0";
const GLOBAL_REL = "global.execution_mode";
const WB_REL = addonMode("wallbox");

function freshUserState(
	val: string,
	lc: number,
	ts = 2000,
): ioBroker.State {
	return { val, ack: false, ts, lc, from: "system.user.admin" } as ioBroker.State;
}

describe("startup rearm", () => {
	it("requires fresh unacked state after bootstrap to clear rearm", () => {
		resetStartupRearmForTest();
		setStartupRearmRequired(true);
		assert.equal(isStartupRearmRequired(), true);
		markBootstrapCompletedForRearm(1000);
		assert.equal(isFreshUserStateChange({ val: "live", ack: false, ts: 999 } as ioBroker.State, 1000), false);
		assert.equal(isFreshUserStateChange({ val: "live", ack: true, ts: 2000 } as ioBroker.State, 1000), false);
		assert.equal(isFreshUserStateChange({ val: "live", ack: false, ts: 2000 } as ioBroker.State, 1000), true);
		clearStartupRearmRequired();
		assert.equal(isStartupRearmRequired(), false);
	});

	it("1: fresh external live request after bootstrap clears rearm", () => {
		resetStartupRearmForTest();
		setStartupRearmRequired(true);
		markBootstrapCompletedForRearm(1000);
		recordExecutionModeBaseline(GLOBAL_REL, 5);
		assert.equal(
			isExplicitUserLiveRearmRequest(freshUserState("live", 6), NS, GLOBAL_REL, 1000),
			true,
		);
	});

	it("2: fresh external dryrun request does not clear rearm", () => {
		resetStartupRearmForTest();
		markBootstrapCompletedForRearm(1000);
		recordExecutionModeBaseline(GLOBAL_REL, 5);
		recordExecutionModeBaseline(WB_REL, 5);
		assert.equal(
			isExplicitUserExecutionModeRequest(freshUserState("dryrun", 6), NS, GLOBAL_REL, 1000),
			true,
		);
		assert.equal(
			isExplicitUserLiveRearmRequest(freshUserState("dryrun", 6), NS, GLOBAL_REL, 1000),
			false,
		);
		assert.equal(
			isExplicitUserLiveRearmRequest(freshUserState("live", 6), NS, WB_REL, 1000),
			false,
		);
	});

	it("6: adapter origin, stale lc, ack=true and pre-bootstrap are rejected for live rearm", () => {
		resetStartupRearmForTest();
		markBootstrapCompletedForRearm(1000);
		recordExecutionModeBaseline(GLOBAL_REL, 5);

		assert.equal(
			isExplicitUserLiveRearmRequest(
				freshUserState("live", 6, 2000),
				NS,
				GLOBAL_REL,
				1000,
			),
			true,
		);
		assert.equal(
			isExplicitUserLiveRearmRequest(
				{ val: "live", ack: false, ts: 2000, from: "system.adapter.ems.0", lc: 6 } as ioBroker.State,
				NS,
				GLOBAL_REL,
				1000,
			),
			false,
		);
		assert.equal(
			isExplicitUserLiveRearmRequest(
				{ val: "live", ack: false, ts: 2000, from: "ems.0", lc: 6 } as ioBroker.State,
				NS,
				GLOBAL_REL,
				1000,
			),
			false,
		);
		assert.equal(
			isExplicitUserLiveRearmRequest(
				{ val: "live", ack: false, ts: 2000, from: "system.user.admin", lc: 5 } as ioBroker.State,
				NS,
				GLOBAL_REL,
				1000,
			),
			false,
		);
		assert.equal(
			isExplicitUserLiveRearmRequest(
				{ val: "live", ack: true, ts: 2000, from: "system.user.admin", lc: 6 } as ioBroker.State,
				NS,
				GLOBAL_REL,
				1000,
			),
			false,
		);
		assert.equal(
			isExplicitUserLiveRearmRequest(
				freshUserState("live", 6, 999),
				NS,
				GLOBAL_REL,
				1000,
			),
			false,
		);
		assert.equal(
			isExplicitUserLiveRearmRequest(
				freshUserState("invalid", 6),
				NS,
				GLOBAL_REL,
				1000,
			),
			false,
		);
	});

	it("detects adapter-internal origins", () => {
		assert.equal(isAdapterInternalStateOrigin("system.adapter.ems.0", "ems.0"), true);
		assert.equal(isAdapterInternalStateOrigin("ems.0", "ems.0"), true);
		assert.equal(isAdapterInternalStateOrigin("system.user.admin", "ems.0"), false);
	});
});

describe("execution mode dryrun/live write gate", () => {
	function makeAdapter(config: Record<string, unknown> = { global_execution_mode: "live" }) {
		const store = new Map<string, ioBroker.State>();
		return {
			namespace: NS,
			config,
			log: { info: () => {}, warn: () => {} },
			getStateAsync: async (id: string) => store.get(id) ?? null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				store.set(id, { val: st.val, ack: st.ack ?? false } as ioBroker.State);
			},
			setObjectNotExistsAsync: async () => undefined,
			store,
		};
	}

	it("dryrun global blocks writes even if addon live", async () => {
		const adapter = makeAdapter({ global_execution_mode: "live", wb_addon_mode: "live" });
		await handleExecutionModeStateChange(adapter, `${NS}.${GLOBAL_REL}`, freshUserState("dryrun", 2));
		await handleExecutionModeStateChange(adapter, `${NS}.${WB_REL}`, freshUserState("live", 2));
		assert.equal(adapter.store.get(GLOBAL_REL)?.val, "dryrun");
		assert.equal(adapter.store.get(WB_REL)?.val, "live");
		assert.equal(await isLiveWriteAllowed(adapter.getStateAsync, "wallbox"), false);
	});

	it("live global + live addon allows writes", async () => {
		const adapter = makeAdapter({ global_execution_mode: "dryrun", wb_addon_mode: "dryrun" });
		await handleExecutionModeStateChange(adapter, `${NS}.${GLOBAL_REL}`, freshUserState("live", 2));
		await handleExecutionModeStateChange(adapter, `${NS}.${WB_REL}`, freshUserState("live", 3));
		assert.equal(await isLiveWriteAllowed(adapter.getStateAsync, "wallbox"), true);
	});

	it("live global + dryrun addon blocks writes", async () => {
		const adapter = makeAdapter();
		await adapter.setStateAsync(GLOBAL_REL, { val: "live", ack: true });
		await adapter.setStateAsync(WB_REL, { val: "dryrun", ack: true });
		assert.equal(await isLiveWriteAllowed(adapter.getStateAsync, "wallbox"), false);
	});

	it("sync from admin live config mirrors object tree and allows writes", async () => {
		const adapter = makeAdapter({ global_execution_mode: "live", wb_addon_mode: "live" });
		await syncExecutionModesFromConfig(adapter, adapter.config, {});
		assert.equal(adapter.store.get(GLOBAL_REL)?.val, "live");
		assert.equal(adapter.store.get(WB_REL)?.val, "live");
		assert.equal(await isLiveWriteAllowed(adapter.getStateAsync, "wallbox"), true);
	});
});
