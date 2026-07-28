import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveImmersionSurplusPullForward } from "./surplus_pull_forward";

const STAGE = [{ index: 1, enabled: true, nominalPowerW: 1700, setStateId: "relay.1" }];

describe("immersion surplus pull-forward", () => {
	it("pulls stage when plan is 0 W, buffer below target, surplus covers stage", () => {
		const r = resolveImmersionSurplusPullForward({
			useDailyPlan: true,
			commandedStage: 0,
			bufferTempC: 49,
			targetTempC: 52,
			hysteresisK: 1,
			liveSurplusW: 2100,
			stages: STAGE,
			preferredStage: 1,
		});
		assert.equal(r.active, true);
		assert.equal(r.stage, 1);
		assert.match(r.reasonDe, /nachziehen/);
	});

	it("stays off when surplus below stage power", () => {
		const r = resolveImmersionSurplusPullForward({
			useDailyPlan: true,
			commandedStage: 0,
			bufferTempC: 49,
			targetTempC: 52,
			hysteresisK: 1,
			liveSurplusW: 500,
			stages: STAGE,
			preferredStage: 1,
		});
		assert.equal(r.active, false);
		assert.equal(r.stage, 0);
	});

	it("does not override an already allocated stage", () => {
		const r = resolveImmersionSurplusPullForward({
			useDailyPlan: true,
			commandedStage: 1,
			bufferTempC: 49,
			targetTempC: 52,
			hysteresisK: 1,
			liveSurplusW: 3000,
			stages: STAGE,
			preferredStage: 1,
		});
		assert.equal(r.active, false);
		assert.equal(r.stage, 1);
	});

	it("does not pull when buffer already at/near target", () => {
		const r = resolveImmersionSurplusPullForward({
			useDailyPlan: true,
			commandedStage: 0,
			bufferTempC: 51.5,
			targetTempC: 52,
			hysteresisK: 1,
			liveSurplusW: 3000,
			stages: STAGE,
			preferredStage: 1,
		});
		assert.equal(r.active, false);
	});
});
