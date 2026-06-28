import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateFinalWriteGate, executeBatteryWrite, type BatteryWriteHost, type FinalWriteGate } from "./execute.js";

function okGate(): FinalWriteGate {
	return {
		globalLive: true,
		governanceEnabled: true,
		profileId: "sonnen_em",
		profileLiveControlAvailable: true,
		profileReady: true,
		intentValid: true,
		telemetryReady: true,
		fault: false,
		lockout: false,
		targetMappingConfigured: true,
		ownershipValid: true,
	};
}

function mockHost(): { host: BatteryWriteHost; writes: Array<{ id: string; val: ioBroker.StateValue }> } {
	const writes: Array<{ id: string; val: ioBroker.StateValue }> = [];
	const host: BatteryWriteHost = {
		getForeignStateAsync: async () => null,
		setForeignStateAsync: async (id, state) => {
			const val = state && typeof state === "object" && "val" in state ? (state as ioBroker.SettableState).val : (state as ioBroker.StateValue);
			writes.push({ id, val: val ?? null });
		},
		log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
	};
	return { host, writes };
}

describe("battery final write gate", () => {
	it("blocks when global not live", () => {
		assert.equal(evaluateFinalWriteGate({ ...okGate(), globalLive: false }).rejectCode, "execution_gate_closed");
	});
	it("blocks generic profile", () => {
		assert.equal(evaluateFinalWriteGate({ ...okGate(), profileId: "generic_readonly" }).rejectCode, "profile_not_live_capable");
	});
	it("passes when all conditions met", () => {
		assert.equal(evaluateFinalWriteGate(okGate()).passed, true);
	});
});

describe("executeBatteryWrite", () => {
	it("dryrun never writes to device", async () => {
		const { host, writes } = mockHost();
		const r = await executeBatteryWrite(host, {
			kind: "charge_power",
			stateId: "x.charge",
			value: 2000,
			requestId: "r",
			reason: "test",
			dryrun: true,
			gate: okGate(),
		});
		assert.equal(writes.length, 0);
		assert.equal(r.executed, false);
		assert.equal(r.simulated, true);
	});

	it("live writes through when gate passes", async () => {
		const { host, writes } = mockHost();
		const r = await executeBatteryWrite(host, {
			kind: "operating_mode",
			stateId: "x.mode",
			value: 1,
			requestId: "r",
			reason: "test",
			dryrun: false,
			gate: okGate(),
		});
		assert.equal(writes.length, 1);
		assert.equal(writes[0].id, "x.mode");
		assert.equal(writes[0].val, 1);
		assert.equal(r.executed, true);
	});

	it("live blocked when gate fails (battery disabled)", async () => {
		const { host, writes } = mockHost();
		const r = await executeBatteryWrite(host, {
			kind: "charge_power",
			stateId: "x.charge",
			value: 2000,
			requestId: "r",
			reason: "test",
			dryrun: false,
			gate: { ...okGate(), governanceEnabled: false },
		});
		assert.equal(writes.length, 0);
		assert.equal(r.executed, false);
		assert.equal(r.rejectCode, "addon_disabled");
	});
});
