import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	handleSeasonStateChange,
	initSeasonControl,
	isSeasonallyPausedAddon,
	WINTER_RUNTIME_STATE,
} from "./season_control.js";

function host(source: unknown, previous?: boolean) {
	const states = new Map<string, ioBroker.State>();
	if (source !== undefined) states.set("0_userdata.0.Heizung.Winterbetrieb", { val: source, ack: true } as ioBroker.State);
	if (previous !== undefined) states.set(WINTER_RUNTIME_STATE, { val: previous, ack: true } as ioBroker.State);
	return {
		states,
		config: { winter_operation_state: "0_userdata.0.Heizung.Winterbetrieb" },
		log: { info: () => undefined, warn: () => undefined },
		getStateAsync: async (id: string) => states.get(id) ?? null,
		setStateAsync: async (id: string, state: ioBroker.SettableState) => { states.set(id, { val: state.val, ack: state.ack } as ioBroker.State); },
		setObjectNotExistsAsync: async () => undefined,
		subscribeForeignStatesAsync: async () => undefined,
	};
}

describe("saisonale Laufzeitsteuerung", () => {
	it("pausiert Klima und Heizstab bei Winter=true", async () => {
		const h = host(true);
		await initSeasonControl(h as never);
		assert.equal(isSeasonallyPausedAddon("air_conditioning"), true);
		assert.equal(isSeasonallyPausedAddon("immersion_heater"), true);
		assert.equal(isSeasonallyPausedAddon("battery"), false);
	});

	it("behält bei Quellenausfall den letzten bestätigten Stand", async () => {
		const h = host(undefined, false);
		await initSeasonControl(h as never);
		assert.equal(isSeasonallyPausedAddon("air_conditioning"), false);
		await handleSeasonStateChange(h as never, "0_userdata.0.Heizung.Winterbetrieb", { val: true, ack: true } as ioBroker.State);
		assert.equal(isSeasonallyPausedAddon("air_conditioning"), true);
		await handleSeasonStateChange(h as never, "0_userdata.0.Heizung.Winterbetrieb", { val: null, ack: true } as ioBroker.State);
		assert.equal(isSeasonallyPausedAddon("air_conditioning"), true);
		await handleSeasonStateChange(h as never, "0_userdata.0.Heizung.Winterbetrieb", { val: false, ack: true } as ioBroker.State);
	});
});
