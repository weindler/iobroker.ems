/**
 * VIS operations dashboard: layout + state contracts (no planner logic).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const visHtml = readFileSync(join(dir, "ems-charts.html"), "utf8");
const adminHtml = readFileSync(join(dir, "..", "admin", "ems-charts.html"), "utf8");
const viewJson = readFileSync(join(dir, "ems-dashboard-view.json"), "utf8");

function extractScript(html) {
	const start = html.indexOf("<script>");
	const end = html.lastIndexOf("</script>");
	assert.ok(start >= 0 && end > start, "ems-charts.html must contain a script block");
	return html.slice(start + "<script>".length, end);
}

function loadOpsDisplay(html) {
	const start = html.indexOf("/* vis-ops-display */");
	const end = html.indexOf("/* /vis-ops-display */");
	assert.ok(start >= 0 && end > start, "vis-ops-display markers required");
	const code = html.slice(start, end);
	return new Function(
		`${code}; return { visBatteryMotion, visEmsAction, visGbStatus, visGridFlow, visTargetedHold, visPriceBand, visPriceAxisRange, visClimateNote, visAcConfiguredName };`,
	)();
}

function snap(over = {}) {
	return {
		chargingW: 0,
		dischargingW: 0,
		powerW: 0,
		operatingMode: "self_consumption",
		action: "self_consumption",
		owner: "none",
		evccBatteryMode: "normal",
		batteryHoldForEv: false,
		tibber: false,
		externalEv: false,
		gbActive: false,
		gbEnabled: false,
		gbReady: false,
		gbReason: "",
		gbPriceAllowed: false,
		gbPrice: 24.3,
		gbMin: 30,
		gbEffectiveW: 0,
		surplusW: 0,
		deficitW: 0,
		holdDetected: true,
		...over,
	};
}

const REQUIRED_STATE_PATHS = [
	"operator.vis.price_timeline_json",
	"operator.diagnostics.surplus_w",
	"operator.diagnostics.deficit_w",
	"live.pv.power_w",
	"live.battery.house_load_w",
	"live.battery.soc_pct",
	"live.price.now_ct_per_kwh",
	"addons.battery.telemetry.charging_power_w",
	"addons.battery.telemetry.discharging_power_w",
	"addons.battery.telemetry.power_w",
	"addons.battery.telemetry.operating_mode",
	"addons.battery.runtime.battery_setpoint_owner",
	"addons.battery.runtime.action",
	"addons.battery.grid_balance.enabled",
	"addons.battery.grid_balance.active",
	"addons.battery.grid_balance.ready",
	"addons.battery.grid_balance.block_reason",
	"addons.battery.grid_balance.price_allowed",
	"addons.battery.grid_balance.price_min_ct_kwh",
	"addons.battery.grid_balance.effective_power_w",
	"addons.battery.grid_balance.grid_power_w",
	"addons.battery.grid_balance.hold_detected",
	"planner.intent.contributions.immersion_heater.contributions_json",
	"addons.immersion_heater.runtime.boiler_temperature_c",
	"addons.immersion_heater.runtime.buffer_temperature_c",
	"addons.immersion_heater.runtime.plan_target_temp_c",
	"addons.immersion_heater.runtime.planning_max_temp_c",
	"learning.thermal_boiler.model",
	"learning.thermal_boiler.quality",
	"addons.air_conditioning.units.unit_1.mode_purpose",
	"addons.air_conditioning.units.unit_2.mode_purpose",
	"addons.air_conditioning.units.unit_1.expected_power_w",
	"addons.wallbox.runtime.connected",
	"addons.wallbox.status.evcc.loadpoint_mode",
	"addons.wallbox.status.evcc.battery_mode",
	"addons.wallbox.runtime.battery_hold_for_ev_charge",
	"addons.wallbox.status.ev_foundation.ev_execution_authority",
	"addons.wallbox.runtime.tibber_grid_rewards_active",
];

describe("VIS operations dashboard", () => {
	it("vis and admin ems-charts.html stay in sync", () => {
		assert.equal(visHtml, adminHtml);
	});

	it("ems-charts.html script parses", () => {
		assert.doesNotThrow(() => new Function(extractScript(visHtml)));
	});

	it("subscribes to existing states for the live strip and price board", () => {
		for (const path of REQUIRED_STATE_PATHS) {
			assert.match(visHtml, new RegExp(path.replace(/\./g, "\\.")));
		}
	});

	it("does not subscribe to daily_plan.slots_json (uses compact vis surface)", () => {
		assert.equal(visHtml.includes("daily_plan.slots_json"), false);
	});

	it("shows GB as AUS / BLOCKIERT / BEREIT / AKTIV and price allowance separately", () => {
		assert.match(visHtml, /label:"AUS"/);
		assert.match(visHtml, /label:"AKTIV"/);
		assert.match(visHtml, /label:"BEREIT"/);
		assert.match(visHtml, /label:"BLOCKIERT"/);
		assert.match(visHtml, /GB preislich /);
		assert.match(visHtml, /Netzausgleich ab /);
		assert.match(visHtml, /price_below_minimum:"Preis unter Schwelle"/);
	});

	it("keeps boiler and buffer as separate rows", () => {
		assert.match(visHtml, /\["Boiler",boilerTemp\]/);
		assert.match(visHtml, /\["Puffer",bufferTemp\]/);
	});

	it("shows climate as LIVE / LÄUFT / DRY|COOL|HEAT|FAN from existing states", () => {
		assert.match(visHtml, /function climateHvacBadge/);
		assert.match(visHtml, /label:"DRY"/);
		assert.match(visHtml, /label:"COOL"/);
		assert.match(visHtml, /label:"HEAT"/);
		assert.match(visHtml, /label:"FAN"/);
		assert.match(visHtml, /label:"LÄUFT"/);
		assert.match(visHtml, /mode_purpose/);
		assert.match(visHtml, /badge\.hvac/);
	});

	it("renders a Tibber price axis from operator.vis.price_timeline_json", () => {
		assert.match(visHtml, /function renderPriceBoard/);
		assert.match(visHtml, /Tibber-Preis/);
		assert.match(visHtml, /operator\.vis\.price_timeline_json/);
		assert.match(visHtml, /gbPriceOk/);
		assert.match(visHtml, /battery_grid/);
		assert.match(visHtml, />günstig</);
		assert.match(visHtml, />mittel</);
		assert.match(visHtml, />teuer</);
		assert.match(visHtml, />sehr teuer</);
		assert.match(visHtml, /GB-Schwelle/);
		assert.equal(visHtml.includes('s.gbPriceOk?"#3fb95099"'), false);
		assert.equal(visHtml.includes("GB preislich ok"), false);
		assert.equal(visHtml.includes(">normal</"), false);
		assert.match(visHtml, /function visPriceBand/);
		assert.match(visHtml, /grid-template-columns:minmax\(0,1fr\) 148px/);
		assert.match(visHtml, /html,body\{height:100%;overflow:hidden\}/);
		assert.match(visHtml, /\.ems-price-svg\{width:100%;height:84px/);
		assert.match(visHtml, /var W=640,H=84/);
		assert.equal(visHtml.includes("H=108"), false);
		assert.match(visHtml, /display="flex"/);
		assert.match(visHtml, /ems-tiles-dense/);
	});

	it("does not put long Newton/planner explain text in the live header", () => {
		assert.equal(/ems-now[\s\S]{0,200}cooling_k_per_h/.test(visHtml), false);
		assert.match(visHtml, /sammelt Daten/);
		assert.match(visHtml, /belastbar/);
		assert.match(visHtml, /chip\("EMS-Aktion"/);
		assert.equal(visHtml.includes("Owner / Aktion"), false);
	});

	it("outer VIS view is compact: no briefing, no ENERGIE cards", () => {
		assert.equal(viewJson.includes("operator.briefing_de"), false);
		assert.equal(viewJson.includes("ENERGIE"), false);
		assert.equal(viewJson.includes("HEIZSTAB"), false);
		assert.match(viewJson, / \| Modus /);
		assert.match(viewJson, / \| Steuerung /);
		assert.match(visHtml, /operator\.briefing_de/);
	});

	it("Demnächst uses Daily Plan allocations only, not chart_json merge", () => {
		assert.match(visHtml, /kein Chart-Merge/);
		assert.match(visHtml, /Batterie-Netzladung/);
		assert.match(visHtml, /name:"Wallbox"/);
		assert.match(visHtml, /acUnitLabel/);
		assert.equal(visHtml.includes("slotsFromChart"), false);
		assert.match(visHtml, /addon:"wallbox".*name:"Wallbox"/);
	});
});

describe("VIS battery / grid / GB presentation", () => {
	const ops = loadOpsDisplay(visHtml);

	it("does not classify from hold_detected", () => {
		const start = visHtml.indexOf("function visBatteryMotion");
		const end = visHtml.indexOf("function visEmsAction");
		assert.equal(visHtml.slice(start, end).includes("hold_detected"), false);
		assert.equal(visHtml.includes('label:"HOLD"'), false);
		const motion = ops.visBatteryMotion(
			snap({ operatingMode: "self_consumption", chargingW: 2, powerW: 2, holdDetected: true }),
			50,
		);
		assert.equal(motion.label, "EIGENVERBRAUCH");
	});

	it("maps Sonnen self-consumption at ~2 W to EIGENVERBRAUCH", () => {
		assert.equal(
			ops.visBatteryMotion(snap({ operatingMode: "self_consumption", chargingW: 2, powerW: 2 }), 50).label,
			"EIGENVERBRAUCH",
		);
	});

	it("maps targeted EV/Tibber hold to HALTEN", () => {
		assert.equal(
			ops.visBatteryMotion(
				snap({
					operatingMode: "self_consumption",
					chargingW: 0,
					powerW: 0,
					evccBatteryMode: "hold",
					batteryHoldForEv: true,
					tibber: true,
				}),
				50,
			).label,
			"HALTEN",
		);
		assert.equal(
			ops.visEmsAction(snap({ tibber: true, evccBatteryMode: "hold", batteryHoldForEv: true })),
			"EV-Schnellladen",
		);
	});

	it("maps actual charge / discharge / idle", () => {
		assert.equal(
			ops.visBatteryMotion(
				snap({ operatingMode: "manual", chargingW: 4200, powerW: 4200, owner: "grid_charge", action: "grid_charge" }),
				50,
			).label,
			"LADEN",
		);
		assert.equal(
			ops.visBatteryMotion(snap({ operatingMode: "self_consumption", dischargingW: 850, powerW: -850 }), 50)
				.label,
			"ENTLADEN",
		);
		assert.equal(ops.visBatteryMotion(snap({ operatingMode: "idle", chargingW: 0, powerW: 0 }), 50).label, "RUHE");
	});

	it("translates EMS action, never blocked/grid_charge as main label", () => {
		assert.equal(ops.visEmsAction(snap()), "keine");
		assert.equal(ops.visEmsAction(snap({ owner: "blocked", action: "blocked" })), "keine");
		assert.equal(ops.visEmsAction(snap({ owner: "grid_charge", action: "grid_charge" })), "Batterie-Netzladung");
		assert.equal(ops.visEmsAction(snap({ owner: "grid_balance", gbActive: true })), "Netzausgleich");
		assert.equal(ops.visEmsAction(snap({ owner: "planned_charge", action: "charge" })), "Batterie-Ladung");
	});

	it("separates GB AUS / BLOCKIERT / BEREIT / AKTIV", () => {
		const off = ops.visGbStatus(snap({ gbEnabled: false, gbReason: "addon_dryrun" }));
		assert.equal(off.label, "AUS");
		assert.equal(off.reason, "");

		const blocked = ops.visGbStatus(snap({ gbEnabled: true, gbReason: "addon_dryrun" }));
		assert.equal(blocked.label, "BLOCKIERT");
		assert.equal(blocked.reason, "Batterie Dryrun");

		const price = ops.visGbStatus(
			snap({ gbEnabled: true, gbReason: "price_below_minimum", gbPrice: 24.3, gbMin: 30 }),
		);
		assert.equal(price.label, "BLOCKIERT");
		assert.equal(price.reason, "Preis 24,3 < 30,0 ct");

		const ready = ops.visGbStatus(snap({ gbEnabled: true, gbReady: true, gbPriceAllowed: true }));
		assert.equal(ready.label, "BEREIT");
		assert.equal(ready.reason, "preislich erlaubt");

		const active = ops.visGbStatus(snap({ gbEnabled: true, gbActive: true, gbEffectiveW: 850 }));
		assert.equal(active.label, "AKTIV");
		assert.equal(active.reason, "850 W");
	});

	it("Netz chip uses surplus/deficit, not GB grid_power_w", () => {
		const start = visHtml.indexOf("function visGridFlow");
		const end = visHtml.indexOf("/* /vis-ops-display */");
		const body = visHtml.slice(start, end);
		assert.equal(body.includes("grid_power_w"), false);
		assert.equal(ops.visGridFlow(snap({ surplusW: 2795, deficitW: 0 }), 50).v, "EINSPEISUNG 2795 W");
		assert.equal(ops.visGridFlow(snap({ surplusW: 0, deficitW: 400 }), 50).v, "BEZUG 400 W");
	});

	it("colors price bars by günstig/mittel/teuer/sehr teuer, not gbPriceOk", () => {
		assert.equal(ops.visPriceBand(10, 10, 40), "cheap");
		assert.equal(ops.visPriceBand(18, 10, 40), "medium");
		assert.equal(ops.visPriceBand(25, 10, 40), "medium");
		assert.equal(ops.visPriceBand(32, 10, 40), "expensive");
		assert.equal(ops.visPriceBand(40, 10, 40), "very");
		assert.match(visHtml, /visPriceBandFill\(visPriceBand\(ct,bandLo,bandHi\)\)/);
		assert.match(visHtml, /s\.current&&s\.gbPriceOk/);
		assert.equal(visHtml.includes('if(s.current)fill="#f0b429"'), false);
		assert.match(visHtml, /stroke="#f0b429"/);
	});

	it("scales Tibber bars against the configured GB min price, not a hardcoded 30 ct", () => {
		const r = ops.visPriceAxisRange([27, 34], 30);
		const span = r.axisMax - r.axisMin;
		const h27 = (27 - r.axisMin) / span;
		const h30 = (30 - r.axisMin) / span;
		const h34 = (34 - r.axisMin) / span;
		assert.ok(r.axisMin < 27, "scale keeps room below 27 ct");
		assert.ok(h27 < h30, "27 ct bar stays below the 30 ct threshold");
		assert.ok(h34 > h30, "34 ct bar extends above the 30 ct threshold");
		assert.ok(h30 > 0.28 && h30 < 0.72, "threshold sits in the readable mid band");

		const r40 = ops.visPriceAxisRange([36, 45], 40);
		const s40 = r40.axisMax - r40.axisMin;
		assert.ok((36 - r40.axisMin) / s40 < (40 - r40.axisMin) / s40);
		assert.ok((45 - r40.axisMin) / s40 > (40 - r40.axisMin) / s40);

		assert.match(visHtml, /visPriceAxisRange\(prices,gbMin\)/);
		assert.match(visHtml, /price_min_ct_kwh/);
		assert.match(visHtml, /GB preislich erlaubt/);
		assert.match(visHtml, /GB gesperrt/);
		const axisFn = visHtml.slice(visHtml.indexOf("function visPriceAxisRange"), visHtml.indexOf("function visClimateNote"));
		assert.equal(/gbMin\s*===\s*30|axisMin\s*=\s*30/.test(axisFn), false);
	});

	it("translates climate runtime states to short everyday notes", () => {
		assert.equal(
			ops.visClimateNote({
				running: true,
				cleaningActive: true,
				decisionSource: "cleaning",
				reasonDe: "Reinigung aktiv — Kühlung gesperrt.",
				demand: "none",
			}),
			"Reinigung aktiv",
		);
		assert.equal(
			ops.visClimateNote({
				running: true,
				cleaningActive: false,
				decisionSource: "temperature_no_demand",
				reasonDe: "Kein NOW-Allocation-Eintrag — laufendes Gerät halten (kein Planner-OFF).",
				demand: "hold",
			}),
			"Läuft weiter bis Abschaltgrenze",
		);
		assert.equal(
			ops.visClimateNote({
				running: true,
				cleaningActive: false,
				decisionSource: "daily_plan",
				reasonDe: "Läuft (Temp 26.0 °C ≥ 24.5 °C — cool).",
				demand: "active",
			}),
			"Kühlbedarf vorhanden",
		);
		assert.equal(
			ops.visClimateNote({
				running: false,
				cleaningActive: false,
				decisionSource: "daily_plan",
				reasonDe: "Daily Plan: keine aktive Allocation für air_conditioning.unit_2 (0 W).",
				allocationReasonDe: "Daily Plan: keine aktive Allocation für air_conditioning.unit_2 (0 W).",
				demand: "none",
				hasFuture: false,
				allocOn: false,
			}),
			"Keine Kühlung erforderlich",
		);
		assert.equal(
			ops.visClimateNote({
				running: false,
				cleaningActive: false,
				decisionSource: "daily_plan",
				reasonDe: "",
				demand: "none",
				hasFuture: true,
				allocOn: false,
			}),
			"Wartet auf geplanten Slot",
		);
		assert.equal(
			ops.visClimateNote({
				running: false,
				outsideWindow: true,
				reasonDe: "Außerhalb Zeitfenster 08:00–22:00.",
				demand: "none",
			}),
			"Durch EMS gesperrt",
		);
		assert.match(visHtml, /climateCardNote\(unitIndex\)/);
		assert.equal(visHtml.includes('shortNote(g(base+".reason_de")'), false);
		assert.match(visHtml, /Klima 1 intern/);
	});

	it("renders climate cards only for units with a real configured name", () => {
		assert.equal(ops.visAcConfiguredName(null), "");
		assert.equal(ops.visAcConfiguredName(""), "");
		assert.equal(ops.visAcConfiguredName("—"), "");
		assert.equal(ops.visAcConfiguredName(" Wohnzimmer EG "), "Wohnzimmer EG");
		assert.equal(ops.visAcConfiguredName("Josef Zimmer OG"), "Josef Zimmer OG");
		assert.match(visHtml, /visAcConfiguredName\(g\(base\+"\.name"\)\)/);
		assert.equal(visHtml.includes('if(!name&&!g(base+".room_temp_c")'), false);
		assert.equal(visHtml.includes("Klima · —"), false);
		assert.match(visHtml, /acCard\(5\)/);
		assert.match(visHtml, /ems-tiles-dense/);
	});
});
