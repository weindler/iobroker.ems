import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WALLBOX_EVCC_STATES } from "./ensure_evcc_states";
import { WB_EVCC_EFFECTIVE_PLAN_TIME, WB_EVCC_PLAN_TIME } from "./evcc_config";
import { refreshWallboxEvccTelemetry } from "./index";

type RefreshHost = Parameters<typeof refreshWallboxEvccTelemetry>[0];

interface MirrorHarness {
	host: RefreshHost;
	writes: Map<string, ioBroker.StateValue>;
}

function mirrorHost(opts: {
	config: Record<string, unknown>;
	foreign: Record<string, unknown>;
	preset?: Record<string, ioBroker.StateValue>;
}): MirrorHarness {
	const writes = new Map<string, ioBroker.StateValue>();
	for (const [id, val] of Object.entries(opts.preset ?? {})) {
		writes.set(id, val);
	}
	const host = {
		config: opts.config,
		async getForeignStateAsync(id: string) {
			if (!(id in opts.foreign)) return null;
			return { val: opts.foreign[id] as ioBroker.StateValue, ts: Date.now(), ack: true } as ioBroker.State;
		},
		async getStateAsync(id: string) {
			if (!writes.has(id)) return null;
			return { val: writes.get(id)!, ts: Date.now(), ack: true } as ioBroker.State;
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			const val = typeof state === "object" && state ? (state as { val: ioBroker.StateValue }).val : (state as ioBroker.StateValue);
			writes.set(id, val);
			return;
		},
		async setObjectNotExistsAsync() {
			return;
		},
		log: { debug() {}, info() {}, warn() {}, error() {} },
	} as unknown as RefreshHost;
	return { host, writes };
}

describe("wallbox evcc mirror states (plan times)", () => {
	const PLAN_SRC = "evcc.0.status.planTime";
	const EFF_SRC = "evcc.0.status.effectivePlanTime";
	const config = {
		[WB_EVCC_PLAN_TIME]: PLAN_SRC,
		[WB_EVCC_EFFECTIVE_PLAN_TIME]: EFF_SRC,
	};

	it("clears a stale effective_plan_time when the source is null", async () => {
		const { host, writes } = mirrorHost({
			config,
			foreign: { [PLAN_SRC]: null, [EFF_SRC]: null },
			preset: { [WALLBOX_EVCC_STATES.effectivePlanTime]: "2026-06-29T05:00:00.000Z" },
		});
		await refreshWallboxEvccTelemetry(host);
		assert.equal(writes.get(WALLBOX_EVCC_STATES.effectivePlanTime), "");
	});

	it("clears a stale plan_time when the source is null", async () => {
		const { host, writes } = mirrorHost({
			config,
			foreign: { [PLAN_SRC]: null, [EFF_SRC]: null },
			preset: { [WALLBOX_EVCC_STATES.planTime]: "2026-06-29T05:00:00.000Z" },
		});
		await refreshWallboxEvccTelemetry(host);
		assert.equal(writes.get(WALLBOX_EVCC_STATES.planTime), "");
	});

	it("clears the mirror state on an invalid source value", async () => {
		const { host, writes } = mirrorHost({
			config,
			foreign: { [PLAN_SRC]: "not-a-date", [EFF_SRC]: "null" },
			preset: {
				[WALLBOX_EVCC_STATES.planTime]: "2026-06-29T05:00:00.000Z",
				[WALLBOX_EVCC_STATES.effectivePlanTime]: "2026-06-29T05:00:00.000Z",
			},
		});
		await refreshWallboxEvccTelemetry(host);
		assert.equal(writes.get(WALLBOX_EVCC_STATES.planTime), "");
		assert.equal(writes.get(WALLBOX_EVCC_STATES.effectivePlanTime), "");
	});

	it("keeps a valid ISO timestamp in the mirror state", async () => {
		const { host, writes } = mirrorHost({
			config,
			foreign: { [EFF_SRC]: "2026-06-29T05:00:00.000Z" },
		});
		await refreshWallboxEvccTelemetry(host);
		assert.equal(writes.get(WALLBOX_EVCC_STATES.effectivePlanTime), "2026-06-29T05:00:00.000Z");
	});

	it("treats the EVCC zero-time sentinel as no plan and clears the mirror state", async () => {
		const { host, writes } = mirrorHost({
			config,
			foreign: { [EFF_SRC]: "0001-01-01T00:00:00Z" },
			preset: { [WALLBOX_EVCC_STATES.effectivePlanTime]: "2026-06-29T05:00:00.000Z" },
		});
		await refreshWallboxEvccTelemetry(host);
		assert.equal(writes.get(WALLBOX_EVCC_STATES.effectivePlanTime), "");
	});

	it("keeps other telemetry fields untouched while clearing plan times", async () => {
		const { host, writes } = mirrorHost({
			config: {
				...config,
				wb_evcc_plan_active_state: "evcc.0.status.planActive",
				wb_evcc_plan_soc_state: "evcc.0.status.planSoc",
				wb_evcc_session_energy_kwh_state: "evcc.0.status.sessionEnergy",
				wb_evcc_vehicle_soc_state: "evcc.0.status.vehicleSoc",
				wb_evcc_charge_power_w_state: "evcc.0.status.chargePower",
			},
			foreign: {
				[PLAN_SRC]: null,
				[EFF_SRC]: null,
				"evcc.0.status.planActive": false,
				"evcc.0.status.planSoc": 80,
				"evcc.0.status.sessionEnergy": 219.683,
				"evcc.0.status.vehicleSoc": 55,
				"evcc.0.status.chargePower": 0,
			},
		});
		await refreshWallboxEvccTelemetry(host);

		assert.equal(writes.get(WALLBOX_EVCC_STATES.planTime), "");
		assert.equal(writes.get(WALLBOX_EVCC_STATES.effectivePlanTime), "");
		assert.equal(writes.get(WALLBOX_EVCC_STATES.planActive), false);
		assert.equal(writes.get(WALLBOX_EVCC_STATES.planSocPct), 80);
		assert.equal(writes.get(WALLBOX_EVCC_STATES.sessionEnergyKwh), 0.219683);
		assert.equal(writes.get(WALLBOX_EVCC_STATES.vehicleSocPct), 55);
		assert.equal(writes.get(WALLBOX_EVCC_STATES.chargePowerW), 0);

		const snapshotRaw = writes.get(WALLBOX_EVCC_STATES.snapshotJson);
		assert.equal(typeof snapshotRaw, "string");
		const snap = JSON.parse(String(snapshotRaw));
		assert.equal(snap.plan_time.value, null);
		assert.equal(snap.effective_plan_time.value, null);
		assert.equal(snap.plan_active.value, false);
		assert.equal(snap.session_energy_kwh.value, 0.219683);
	});
});
