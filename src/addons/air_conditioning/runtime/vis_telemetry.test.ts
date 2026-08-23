import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAcFilterVis, resolveAcPowerDisplay } from "./vis_telemetry.js";

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
	});

	it("5) filter wash → Reinigen + warn", () => {
		const f = resolveAcFilterVis({ statusRaw: "wash", usagePct: 90, usageHours: 400 });
		assert.equal(f.labelDe, "Reinigen");
		assert.equal(f.warnDe, "FILTER REINIGEN");
	});

	it("6) filter replace → Ersetzen", () => {
		const f = resolveAcFilterVis({ statusRaw: "replace", usagePct: null, usageHours: null });
		assert.equal(f.labelDe, "Ersetzen");
		assert.equal(f.warnDe, "FILTER ERSETZEN");
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
	});

	it("off without power → none", () => {
		const d = resolveAcPowerDisplay({ measuredPowerW: null, estimatedPowerW: 700, running: false });
		assert.equal(d.kind, "none");
	});
});
