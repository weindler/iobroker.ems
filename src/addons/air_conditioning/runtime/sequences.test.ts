import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeviceWriteHost } from "../../../device_write";
import { executeAcWriteSteps, type AcMappingTable } from "./sequences";

describe("ac sequences write steps", () => {
	it("toggle step resets mirror ack:true then force pulse ack:false", async () => {
		const writes: Array<{ id: string; val: unknown; ack: boolean }> = [];
		const host: DeviceWriteHost = {
			getForeignStateAsync: async () => ({ val: true, ack: true, ts: 0, lc: 0, from: "test" }),
			setForeignStateAsync: async (id, state) => {
				if (state && typeof state === "object" && "val" in state && "ack" in state) {
					writes.push({ id, val: state.val, ack: state.ack as boolean });
				}
			},
		};
		const table: AcMappingTable = {
			unit_2_cmd_switch_on: { enabled: true, targetStateId: "st.on" },
		};
		await executeAcWriteSteps(host, 2, table, [{ kind: "toggle", role: "cmd_switch_on" }], true);
		assert.equal(writes.length, 2);
		assert.deepEqual(writes[0], { id: "st.on", val: false, ack: true });
		assert.deepEqual(writes[1], { id: "st.on", val: true, ack: false });
	});

	it("dryrun does not write", async () => {
		let wrote = false;
		const host: DeviceWriteHost = {
			getForeignStateAsync: async () => null,
			setForeignStateAsync: async () => {
				wrote = true;
			},
		};
		const table: AcMappingTable = {
			unit_2_cmd_switch_on: { enabled: true, targetStateId: "st.on" },
		};
		await executeAcWriteSteps(host, 2, table, [{ kind: "toggle", role: "cmd_switch_on" }], false);
		assert.equal(wrote, false);
	});

	it("switch_off writes off/false to all mapped switch targets", async () => {
		const writes: Array<{ id: string; val: unknown }> = [];
		const host: DeviceWriteHost = {
			getForeignStateAsync: async () => ({ val: "on", ack: true, ts: 0, lc: 0, from: "test" }),
			setForeignStateAsync: async (id, state) => {
				const val = state && typeof state === "object" && "val" in state ? state.val : state;
				writes.push({ id, val });
			},
		};
		const table: AcMappingTable = {
			unit_2_cmd_switch_on: { enabled: true, targetStateId: "st.switch" },
			unit_2_cmd_switch_off: { enabled: true, targetStateId: "st.switch" },
			unit_2_feedback_switch: { enabled: true, targetStateId: "st.switch" },
		};
		await executeAcWriteSteps(host, 2, table, [{ kind: "switch_off" }], true);
		assert.ok(writes.some((w) => w.id === "st.switch" && w.val === "off"));
		assert.ok(writes.some((w) => w.id === "st.switch" && w.val === false));
	});

	it("switch_off on dedicated off also pulses after set", async () => {
		const writes: Array<{ id: string; val: unknown }> = [];
		const host: DeviceWriteHost = {
			getForeignStateAsync: async () => ({ val: false, ack: true, ts: 0, lc: 0, from: "test" }),
			setForeignStateAsync: async (id, state) => {
				const val = state && typeof state === "object" && "val" in state ? state.val : state;
				writes.push({ id, val });
			},
		};
		const table: AcMappingTable = {
			unit_2_cmd_switch_on: { enabled: true, targetStateId: "st.on" },
			unit_2_cmd_switch_off: { enabled: true, targetStateId: "st.off" },
			unit_2_feedback_switch: { enabled: true, targetStateId: "st.switch" },
		};
		await executeAcWriteSteps(host, 2, table, [{ kind: "switch_off" }], true);
		assert.ok(writes.some((w) => w.id === "st.off" && w.val === "off"));
		assert.ok(writes.some((w) => w.id === "st.switch" && w.val === "off"));
		assert.ok(writes.some((w) => w.id === "st.off" && w.val === true));
	});
});
