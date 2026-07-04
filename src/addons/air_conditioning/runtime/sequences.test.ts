import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeviceWriteHost } from "../../../device_write";
import {
	collectToggleMirrorIds,
	resetToggleMirrorsNow,
	scheduleToggleMirrorReset,
	type AcMappingTable,
} from "./sequences";

describe("ac sequences toggle mirror reset", () => {
	it("collectToggleMirrorIds gathers mapped toggle roles", () => {
		const table: AcMappingTable = {
			unit_2_cmd_switch_on: { enabled: true, targetStateId: "st.switch-on" },
			unit_2_cmd_switch_off: { enabled: true, targetStateId: "st.switch-off" },
			unit_2_cmd_refresh: { enabled: false, targetStateId: "st.refresh" },
		};
		assert.deepEqual(collectToggleMirrorIds(table, 2), ["st.switch-on", "st.switch-off"]);
	});

	it("resetToggleMirrorsNow writes false with ack true", async () => {
		const writes: Array<{ id: string; val: unknown; ack: boolean }> = [];
		const host: DeviceWriteHost = {
			getForeignStateAsync: async () => null,
			setForeignStateAsync: async (id, state) => {
				if (state && typeof state === "object" && "val" in state && "ack" in state) {
					writes.push({ id, val: state.val, ack: state.ack as boolean });
				}
			},
		};
		await resetToggleMirrorsNow(host, ["a", "a", "b"]);
		assert.equal(writes.length, 2);
		assert.equal(writes[0].val, false);
		assert.equal(writes[0].ack, true);
	});

	it("scheduleToggleMirrorReset fires after delay", async () => {
		const writes: string[] = [];
		const host: DeviceWriteHost = {
			getForeignStateAsync: async () => null,
			setForeignStateAsync: async (id, state) => {
				if (state && typeof state === "object" && "val" in state) {
					writes.push(id);
				}
			},
		};
		scheduleToggleMirrorReset(host, ["st.on"], 20);
		assert.equal(writes.length, 0);
		await new Promise((r) => setTimeout(r, 35));
		assert.deepEqual(writes, ["st.on"]);
	});
});
