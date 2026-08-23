import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	acFilterStatusCode,
	resolveAcFilterVis,
	resolveAcPowerDisplay,
} from "./vis_telemetry.js";
import { acUnitRuntimeStates } from "./ensure_states.js";

describe("AC VIS telemetry", () => {
	it("1) measured power >0", () => {
		const d = resolveAcPowerDisplay({ measuredPowerW: 727, estimatedPowerW: 700, running: true });
		assert.equal(d.kind, "measured");
		assert.equal(d.displayPowerW, 727);
	});

	it("2) AC on + power null (0 filtered) → estimated fallback", () => {
		const d = resolveAcPowerDisplay({ measuredPowerW: null, estimatedPowerW: 700, running: true });
		assert.equal(d.kind, "estimated");
		assert.equal(d.displayPowerW, 700);
	});

	it("3) estimated kind when no measurement", () => {
		const d = resolveAcPowerDisplay({ measuredPowerW: null, estimatedPowerW: 650, running: true });
		assert.equal(d.kind, "estimated");
	});

	it("4) filter normal", () => {
		const f = resolveAcFilterVis({ statusRaw: "normal", usagePct: 75, usageHours: 375 });
		assert.equal(f.status, "normal");
		assert.equal(f.labelDe, "Normal");
		assert.equal(f.warnDe, "");
		assert.equal(acFilterStatusCode(f.status), 0);
	});

	it("5) filter wash → Reinigen + warn", () => {
		const f = resolveAcFilterVis({ statusRaw: "wash", usagePct: 90, usageHours: 400 });
		assert.equal(f.labelDe, "Reinigen");
		assert.equal(f.warnDe, "FILTER REINIGEN");
		assert.equal(acFilterStatusCode(f.status), 1);
	});

	it("6) filter replace → Ersetzen", () => {
		const f = resolveAcFilterVis({ statusRaw: "replace", usagePct: null, usageHours: null });
		assert.equal(f.labelDe, "Ersetzen");
		assert.equal(f.warnDe, "FILTER ERSETZEN");
		assert.equal(acFilterStatusCode(f.status), 2);
	});

	it("7) filter hours and pct", () => {
		const f = resolveAcFilterVis({ statusRaw: "normal", usagePct: 75.4, usageHours: 375.2 });
		assert.equal(f.usagePct, 75);
		assert.equal(f.usageHours, 375);
	});

	it("8) filter missing entirely", () => {
		const f = resolveAcFilterVis({ statusRaw: null, usagePct: null, usageHours: null });
		assert.equal(f.status, "");
		assert.equal(f.labelDe, "");
		assert.equal(f.warnDe, "");
		assert.equal(acFilterStatusCode(f.status), -1);
	});

	it("filter_status_code mapping", () => {
		assert.equal(acFilterStatusCode("normal"), 0);
		assert.equal(acFilterStatusCode("wash"), 1);
		assert.equal(acFilterStatusCode("replace"), 2);
		assert.equal(acFilterStatusCode("unknown"), -1);
		assert.equal(acFilterStatusCode(""), -1);
		assert.equal(acFilterStatusCode(null), -1);
		assert.equal(acFilterStatusCode(undefined), -1);
		assert.equal(acFilterStatusCode("weird"), -1);
		const fromVis = resolveAcFilterVis({ statusRaw: "garbage", usagePct: 10, usageHours: null });
		assert.equal(acFilterStatusCode(fromVis.status), -1);
	});

	it("filter_status_code paths independent per unit index", () => {
		const u1 = acUnitRuntimeStates(1);
		const u3 = acUnitRuntimeStates(3);
		const u5 = acUnitRuntimeStates(5);
		assert.equal(u1.filterStatusCode, "addons.air_conditioning.units.unit_1.filter_status_code");
		assert.equal(u3.filterStatusCode, "addons.air_conditioning.units.unit_3.filter_status_code");
		assert.equal(u5.filterStatusCode, "addons.air_conditioning.units.unit_5.filter_status_code");
		assert.notEqual(u1.filterStatusCode, u3.filterStatusCode);
		assert.equal(acFilterStatusCode("wash"), 1);
		assert.equal(acFilterStatusCode("normal"), 0);
	});

	it("off without power → none", () => {
		const d = resolveAcPowerDisplay({ measuredPowerW: null, estimatedPowerW: 700, running: false });
		assert.equal(d.kind, "none");
	});
});
