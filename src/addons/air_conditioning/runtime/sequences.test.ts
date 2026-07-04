import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeviceWriteHost } from "../../../device_write";
import { executeAcWriteSteps, type AcMappingTable } from "./sequences";

describe("ac sequences write steps", () => {
	it("toggle step uses force write even when state already true", async () => {
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
		assert.equal(writes.length, 1);
		assert.equal(writes[0].val, true);
		assert.equal(writes[0].ack, false);
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
});
