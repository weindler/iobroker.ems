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
		`${code}; return { visBatteryMotion, visEmsAction, visGbStatus, visGridMeterW, visGridFlow, visTargetedHold, visPriceBand, visPriceAxisRange, visClimateNote, visAcConfiguredName, visClimateHvacBadge, visHvacPurposeLabel, visFmtDurationSec, visFmtKwh, visJoinDurEnergy, visAcPowerDisplayLine, visAcFilterWarn, visAcTodayEnergyLine, visPvBiasPhrase, visPvChipSub, visHorizonOutlook, visLageLine, visLageFacts, visPvIstKwh, visTodayDeviationPct, visDeviationVsRecent, visCheapPhaseLabel, visPriceHeadSummary, visIdleFacts, visNowSummary, visRowValueOk, visBatteryPlanLine, visEnergySourceLabel, visWindowEnergyKwh, visImmersionDemandFact, visImmersionWaitNote, visAgendaBuckets, visLocalDayEndMs, visBatteryRemainKwh, visBatteryDayLines, visCarDayLines, visHorizonDayLabel, visHorizonDayLine, visFirstSentence, visClockRange };`,
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
	"addons.battery.runtime.target_soc_pct",
	"addons.battery.telemetry.capacity_effective_kwh",
	"operator.plan.battery_strategy_de",
	"operator.plan.wallbox_strategy_de",
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
	"learning.thermal_boiler.samples",
	"learning.pv_bias.corrected_today_kwh",
	"learning.pv_bias.corrected_tomorrow_kwh",
	"learning.pv_bias.raw_today_kwh",
	"learning.pv_bias.actual_today_kwh",
	"learning.pv_bias.bias_today_pct",
	"learning.pv_bias.bias_7d_pct",
	"learning.pv_horizon.day3.corrected_kwh",
	"learning.weather.horizon.day1.min_temp_c",
	"addons.air_conditioning.units.unit_1.mode_purpose",
	"addons.air_conditioning.units.unit_1.room_humidity_pct",
	"addons.air_conditioning.units.unit_1.stats.today_runtime_sec",
	"addons.air_conditioning.units.unit_1.stats.today_energy_kwh",
	"addons.air_conditioning.units.unit_2.mode_purpose",
	"addons.air_conditioning.units.unit_1.expected_power_w",
	"addons.wallbox.status.evcc.connected",
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

	it("shows climate HVAC badges only while the device is running", () => {
		assert.match(visHtml, /function climateHvacBadge/);
		assert.match(visHtml, /function visClimateHvacBadge/);
		assert.match(visHtml, /label:"DRY"/);
		assert.match(visHtml, /label:"COOL"/);
		assert.match(visHtml, /label:"HEAT"/);
		assert.match(visHtml, /label:"FAN"/);
		assert.match(visHtml, /label:"LÄUFT"/);
		assert.match(visHtml, /mode_purpose/);
		assert.match(visHtml, /badge\.hvac/);
		assert.match(visHtml, /\["Modus"/);
		assert.equal(visHtml.includes('return{cls:"idle",label:"—"}'), false);
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
		assert.match(visHtml, /grid-template-columns:minmax\(310px,410px\) minmax\(200px,1fr\) minmax\(220px,28%\)/);
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

it("Boiler-Learning compact is cycle-only; Restzeit bevorzugt thermal_runtime mit Fallback", () => {
		assert.match(visHtml, /if\(quality==="cycle"\)return"belastbar"/);
	assert.equal(visHtml.includes("learning.thermal_runtime.estimated_remaining_hours"), true);
	assert.equal(visHtml.includes("learning.thermal_runtime.estimated_empty_at"), true);
	assert.equal(visHtml.includes("learning.thermal_boiler.estimated_remaining_hours"), true);
	assert.equal(visHtml.includes("learning.thermal_boiler.estimated_empty_at"), true);
	});

	it("outer VIS view is compact: no briefing, no ENERGIE cards", () => {
		assert.equal(viewJson.includes("operator.briefing_de"), false);
		assert.equal(viewJson.includes("ENERGIE"), false);
		assert.equal(viewJson.includes("HEIZSTAB"), false);
		assert.match(viewJson, / \| Modus /);
		assert.match(viewJson, / \| Steuerung /);
		assert.match(visHtml, /operator\.briefing_de/);
	});

	it("Nächste Aktionen uses Daily Plan allocations only, not chart_json merge", () => {
		assert.match(visHtml, /kein Chart-Merge/);
		assert.match(visHtml, /Batterie-Netzladung/);
		assert.match(visHtml, /name:"Wallbox"/);
		assert.match(visHtml, /acUnitLabel/);
		assert.equal(visHtml.includes("slotsFromChart"), false);
		assert.match(visHtml, /addon:"wallbox".*name:"Wallbox"/);
		assert.match(visHtml, /EMS – Heute/);
		assert.match(visHtml, /EMS – Morgen \/ Tage/);
		assert.match(visHtml, /function paintEl/);
		assert.match(visHtml, /data-scroll/);
		assert.match(visHtml, /storyBlock\("Klima",climateTodayLines\(\)\)/);
		assert.match(visHtml, /storyBlock\("Klima"[\s\S]*storyBlock\("Batterie"/);
		assert.match(visHtml, /visBatteryDayLines/);
		assert.match(visHtml, /Keine Aktion geplant/);
		assert.equal(visHtml.includes("Demnächst (48 h)"), false);
		assert.equal(visHtml.includes("Keine Fenster geplant."), false);
		assert.match(visHtml, /visIdleFacts/);
		assert.match(visHtml, /visAgendaBuckets/);
		assert.match(visHtml, /visBatteryPlanLine/);
		assert.match(visHtml, /visCheapPhaseLabel/);
		assert.match(visHtml, /PREIS FREI/);
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

	it("does not invent EV-Schnellladen from leftover now/hold without a connected vehicle", () => {
		assert.equal(
			ops.visEmsAction(
				snap({ vehicleConnected: false, batteryHoldForEv: true, tibber: true, externalEv: true }),
			),
			"keine",
		);
		assert.equal(ops.visEmsAction(snap({ evccBatteryMode: "hold" })), "keine");
		assert.equal(
			ops.visEmsAction(snap({ vehicleConnected: true, batteryHoldForEv: true })),
			"EV-Schnellladen",
		);
		assert.equal(
			ops.visTargetedHold(snap({ vehicleConnected: false, batteryHoldForEv: true, evccBatteryMode: "normal" })),
			false,
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

	it("Netz chip uses connection-point power, not surplus/deficit or GB grid_power_w", () => {
		const start = visHtml.indexOf("function visGridMeterW");
		const end = visHtml.indexOf("function visPriceBand");
		const body = visHtml.slice(start, end);
		assert.equal(body.includes("grid_power_w"), false);
		assert.equal(body.includes("surplusW"), false);
		assert.equal(body.includes("deficitW"), false);
		assert.equal(ops.visGridFlow(snap({ surplusW: 2795, deficitW: 0 }), 50).v, "—");
		assert.equal(ops.visGridFlow(snap({ surplusW: 0, deficitW: 400 }), 50).v, "—");
		assert.equal(ops.visGridFlow(snap({ gridW: 2795 }), 50).v, "BEZUG 2795 W");
		assert.equal(ops.visGridFlow(snap({ gridW: -2795 }), 50).v, "EINSPEISUNG 2795 W");
		assert.equal(
			ops.visGridFlow(snap({ houseW: 200, pvW: 2995, chargingW: 0, dischargingW: 0, powerW: 0 }), 50).v,
			"EINSPEISUNG 2795 W",
		);
	});

	it("TEST C: grid import 30 W stays NETZ BEZUG while battery discharges 1450 W", () => {
		const live = snap({
			houseW: 1480,
			pvW: 0,
			dischargingW: 1450,
			powerW: -1450,
			surplusW: 0,
			deficitW: 1480,
			gbEffectiveW: 1480,
			operatingMode: "self_consumption",
			owner: "none",
			action: "self_consumption",
		});
		assert.equal(ops.visGridMeterW(live), 30);
		assert.equal(ops.visGridFlow(live, 50).v, "BEZUG 30 W");
		assert.equal(ops.visGridFlow(snap({ gridW: 30, dischargingW: 1450, powerW: -1450, deficitW: 1480 }), 50).v, "BEZUG 30 W");
		assert.equal(ops.visBatteryMotion(live, 50).label, "ENTLADEN");
	});

	it("TEST D: grid export 800 W is NETZ EINSPEISUNG, battery independent", () => {
		assert.equal(ops.visGridFlow(snap({ gridW: -800, dischargingW: 0, chargingW: 0 }), 50).v, "EINSPEISUNG 800 W");
		assert.equal(
			ops.visGridFlow(
				snap({ houseW: 200, pvW: 1000, chargingW: 0, dischargingW: 0, powerW: 0, surplusW: 800 }),
				50,
			).v,
			"EINSPEISUNG 800 W",
		);
		assert.equal(
			ops.visBatteryMotion(snap({ operatingMode: "self_consumption", chargingW: 2, powerW: 2 }), 50).label,
			"EIGENVERBRAUCH",
		);
	});

	it("TEST E: real discharge without EMS setpoint shows ENTLADEN and EMS-Aktion keine", () => {
		const live = snap({
			operatingMode: "self_consumption",
			dischargingW: 1450,
			powerW: -1450,
			owner: "none",
			action: "self_consumption",
			gbActive: false,
		});
		assert.equal(ops.visBatteryMotion(live, 50).label, "ENTLADEN");
		assert.equal(ops.visEmsAction(live), "keine");
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
		assert.equal(
			ops.visClimateNote({
				running: false,
				cleaningActive: false,
				decisionSource: "daily_plan",
				reasonDe: "Feuchte 65 % ≥ 60 % — dry",
				purpose: "dehumidify",
				demand: "active",
				hasFuture: true,
				allocOn: false,
			}),
			"Entfeuchten geplant",
		);
		assert.equal(
			ops.visClimateNote({
				running: true,
				cleaningActive: false,
				decisionSource: "daily_plan",
				reasonDe: "Feuchte 61 % ≥ 60 % — dry",
				purpose: "dehumidify",
				demand: "active",
			}),
			"Entfeuchtet",
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
		assert.match(visHtml, /room_humidity_pct/);
		assert.match(visHtml, /stats\.today_runtime_sec/);
		assert.match(visHtml, /visRowValueOk/);
	});

	it("hides HVAC mode badges when climate is off; shows them only while running", () => {
		assert.equal(ops.visClimateHvacBadge("cooling", false), null);
		assert.equal(ops.visClimateHvacBadge("dehumidify", false), null);
		assert.deepEqual(ops.visClimateHvacBadge("cooling", true), { cls: "hvac-cool", label: "COOL" });
		assert.deepEqual(ops.visClimateHvacBadge("dehumidify", true), { cls: "hvac-dry", label: "DRY" });
		assert.deepEqual(ops.visClimateHvacBadge("heating", true), { cls: "hvac-heat", label: "HEAT" });
		assert.equal(ops.visHvacPurposeLabel("cooling"), "COOL");
		assert.match(visHtml, /visHvacPurposeLabel\(g\(base\+"\.mode_purpose"\)\)/);
		assert.match(visHtml, /execAuthorityBadge\("air_conditioning"\)/);
		assert.match(visHtml, /climateDeviceBadge\(running\)/);
	});

	it("formats climate runtime and energy for humans", () => {
		assert.equal(ops.visFmtDurationSec(9170), "2 h 33 min");
		assert.equal(ops.visFmtDurationSec(37 * 60), "37 min");
		assert.equal(ops.visFmtDurationSec(0), null);
		assert.equal(ops.visFmtKwh(0.42), "0,42 kWh");
		assert.equal(ops.visFmtKwh(3.7), "3,7 kWh");
		assert.equal(ops.visFmtKwh(307.5), "307,5 kWh");
		assert.equal(ops.visRowValueOk("—"), false);
		assert.equal(ops.visRowValueOk("25,4 °C"), true);
	});

	it("AC LocalThings VIS power/filter/auto-clean helpers", () => {
		assert.equal(ops.visAcPowerDisplayLine("measured", 727), "727 W");
		assert.equal(ops.visAcPowerDisplayLine("estimated", 700), "~700 W");
		assert.equal(ops.visAcPowerDisplayLine("none", 0), "");
		assert.equal(ops.visAcPowerDisplayLine("measured", 0), "");
		assert.deepEqual(ops.visAcFilterWarn("wash"), { text: "FILTER REINIGEN", cls: "warn" });
		assert.deepEqual(ops.visAcFilterWarn("replace"), { text: "FILTER ERSETZEN", cls: "danger" });
		assert.equal(ops.visAcFilterWarn("normal"), null);
		assert.equal(ops.visAcFilterWarn(""), null);
		const today = ops.visAcTodayEnergyLine(4200, 0.84);
		assert.equal(today.dur, "1 h 10 min");
		assert.equal(today.energy, "0,84 kWh");
		assert.equal(
			ops.visClimateNote({
				running: false,
				cleaningActive: true,
				cleaningProgressPct: 42,
				decisionSource: "cleaning",
			}),
			"Reinigung läuft · 42 %",
		);
		assert.equal(
			ops.visClimateNote({
				running: false,
				cleaningActive: false,
				decisionSource: "thermal_fallback",
				reasonDe: "",
				demand: "none",
			}),
			"Keine Kühlung erforderlich",
		);
		assert.match(visHtml, /power_display_kind/);
		assert.match(visHtml, /filter_status_label_de/);
		assert.match(visHtml, /stats\.today_energy_kwh/);
		assert.match(visHtml, /ems-rows-ac/);
		assert.match(visHtml, /setpoint_temp_c/);
		// Neue Unit-States müssen in der Subscribe-Liste stehen, sonst bleibt die Kachel leer.
		assert.match(
			visHtml,
			/fields=\[[^\]]*setpoint_temp_c[^\]]*measured_power_w[^\]]*power_display_kind[^\]]*filter_status[^\]]*filter_status_label_de[^\]]*filter_usage_pct[^\]]*filter_usage_hours/,
		);
		assert.equal(visHtml.includes("hass.0.entities"), false);
	});

	it("summarizes the next cheap phase from visible slots only", () => {
		const slots = [
			{ startIso: "2026-08-17T22:00:00.000Z", endIso: "2026-08-17T22:15:00.000Z", priceCt: 40 },
			{ startIso: "2026-08-17T22:15:00.000Z", endIso: "2026-08-17T22:30:00.000Z", priceCt: 12 },
			{ startIso: "2026-08-17T22:30:00.000Z", endIso: "2026-08-17T22:45:00.000Z", priceCt: 11 },
			{ startIso: "2026-08-17T22:45:00.000Z", endIso: "2026-08-17T23:00:00.000Z", priceCt: 38 },
		];
		const label = ops.visCheapPhaseLabel(slots, Date.parse("2026-08-17T21:00:00.000Z"));
		assert.equal(typeof label, "string");
		assert.match(label, /–/);
		assert.equal(ops.visCheapPhaseLabel(slots.map((s) => ({ ...s, priceCt: 24 })), Date.parse("2026-08-17T21:00:00.000Z")), null);
		assert.equal(
			ops.visPriceHeadSummary(31.6, "00:00–05:00", 30, true),
			"Jetzt 31,6 ct | nächste günstige Phase 00:00–05:00 | GB ab 30,0 ct → PREIS FREI",
		);
		assert.equal(
			ops.visPriceHeadSummary(24.3, null, 30, false),
			"Jetzt 24,3 ct | GB ab 30,0 ct → PREIS GESPERRT",
		);
	});

	it("idle next-actions facts stay strictly factual", () => {
		assert.deepEqual(
			ops.visIdleFacts({
				pvW: 4500,
				houseW: 220,
				surplusW: 4280,
				deficitW: 0,
				socPct: 100,
				batLabel: "EIGENVERBRAUCH",
				boilerC: 59,
				boilerMinC: 48,
				wbConnected: false,
			}),
			[
				"Haus aktuell aus PV versorgt",
				"Batterie 100 % · EIGENVERBRAUCH",
				"Boiler 59,0 °C · kein akuter Bedarf",
				"Wallbox · Fahrzeug getrennt",
			],
		);
		assert.equal(
			ops.visIdleFacts({
				pvW: 200,
				houseW: 800,
				surplusW: 0,
				deficitW: 600,
				socPct: 40,
				batLabel: "ENTLADEN",
			}).includes("Haus aktuell aus PV versorgt"),
			false,
		);
		assert.equal(ops.visNowSummary({ batLabel: "EIGENVERBRAUCH", surplusW: 3200 }).title, "Batterie · EIGENVERBRAUCH");
		assert.match(ops.visNowSummary({ batLabel: "EIGENVERBRAUCH", surplusW: 3200 }).meta, /PV-Überschuss 3,2 kW/);
	});

	it("today agenda shows SOC path, PV/Netz and heater demand from the existing plan", () => {
		assert.equal(ops.visBatteryPlanLine({ socPct: 52, targetSocPct: 60 }), "Batterie 52 % → Plan 60 %");
		assert.equal(ops.visBatteryPlanLine({ socPct: 60, targetSocPct: 60 }), "Batterie 60 % · Plan-Ziel 60 % erreicht");
		assert.equal(ops.visBatteryPlanLine({ socPct: 48 }), "Batterie 48 %");
		assert.equal(ops.visEnergySourceLabel(false), "PV");
		assert.equal(ops.visEnergySourceLabel(true), "Netz");
		assert.equal(ops.visWindowEnergyKwh(1700, 0, 3600000), "1,7 kWh");
		assert.equal(
			ops.visImmersionDemandFact({ requiredKwh: 6.5, minPowerW: 1700, hasWindow: false }),
			"Heizstab Bedarf 6,5 kWh — noch kein fahrbares Fenster (≥ 1700 W)",
		);
		assert.equal(ops.visImmersionDemandFact({ requiredKwh: 6.5, hasWindow: true }), null);
		assert.equal(ops.visImmersionWaitNote("auto_ready_zero_plan_allocation"), "Wartet auf geplanten Slot");
		const noon = Date.parse("2026-08-19T10:00:00");
		const dayEnd = ops.visLocalDayEndMs(noon);
		const buckets = ops.visAgendaBuckets(
			[
				{ name: "Klima", startMs: noon + 5 * 3600000, endMs: noon + 6 * 3600000 },
				{ name: "Heizstab", startMs: noon - 600000, endMs: noon + 600000 },
				{ name: "Morgen", startMs: dayEnd + 3600000, endMs: dayEnd + 7200000 },
			],
			noon,
			10,
			2,
		);
		assert.equal(buckets.current[0].name, "Heizstab");
		assert.equal(buckets.today[0].name, "Klima");
		assert.equal(buckets.later[0].name, "Morgen");
		assert.equal(visHtml.includes('["Restzeit"'), false);
		assert.equal(visHtml.includes('["Leer ca."'), false);
	});

	it("morning plan shows battery path, unplugged car, and coarse horizon days", () => {
		assert.deepEqual(
			ops.visBatteryDayLines({
				socPct: 84,
				targetSocPct: 100,
				capacityKwh: 20,
				strategyDe: "Kein Ladebedarf · SOC 84 %",
				chargingNow: true,
				emsChargeAction: false,
			}),
			["Batterie 84 % → Plan 100 % · noch 3,2 kWh bis 100 %", "Kein Ladebedarf · SOC 84 %", "lädt gerade ohne EMS-Fenster"],
		);
		assert.deepEqual(
			ops.visCarDayLines({ connected: false, socPct: 86, targetSocPct: 90, strategyDe: "Wartet auf Fahrzeug · kein Ladeplan erforderlich" }),
			[
				"Auto nicht angesteckt · 86 % · Ziel 90 %",
				"Wartet auf Fahrzeug · kein Ladeplan erforderlich",
			],
		);
		assert.equal(ops.visHorizonDayLabel(Date.parse("2026-08-19T08:00:00"), 2), "Morgen");
		assert.equal(ops.visHorizonDayLine("Morgen", 31.4, 18, 28), "Morgen · 31 kWh · 18–28 °C");
		assert.equal(ops.visBatteryRemainKwh(84, 20, 100), 3.2);
	});

	it("PV chip and Lage line show bias-corrected horizon in everyday language", () => {
		assert.equal(ops.visPvChipSub({ todayKwh: 18.2 }), "heute 18 kWh");
		assert.equal(ops.visPvChipSub({ todayKwh: 14, actualKwh: 8 }), "Ist 8,0 / 14 kWh");
		assert.equal(ops.visPvBiasPhrase(-14, "ready"), "Forecast bisher zu hoch");
		assert.equal(ops.visPvBiasPhrase(-8, "ready"), "etwas schwächer als Forecast");
		assert.equal(ops.visPvBiasPhrase(14, "ready"), "Forecast bisher zu niedrig");
		assert.equal(ops.visPvBiasPhrase(-20, "insufficient_data"), "");
		assert.equal(ops.visPvBiasPhrase(-2, "ready"), "");
		assert.equal(ops.visHorizonOutlook(18, 8), "danach schwächer");
		assert.equal(ops.visHorizonOutlook(12, 22), "danach kräftiger");
		assert.equal(ops.visHorizonOutlook(18, 19), "danach ähnlich");
		assert.equal(ops.visPvIstKwh({ actualKwh: 8.1 }), 8.1);
		assert.equal(Math.round(ops.visTodayDeviationPct({ todayKwh: 14, actualKwh: 8 })), -43);
		assert.equal(ops.visDeviationVsRecent(-43, -1), "stärker daneben als letzte Tage");
		assert.equal(ops.visDeviationVsRecent(-2, -20), "näher am Forecast als letzte Tage");
		assert.equal(ops.visDeviationVsRecent(-5, -4), "ähnlich den letzten Tagen");
		assert.equal(
			ops.visLageFacts({
				rawTodayKwh: 14.2,
				todayKwh: 14,
				actualKwh: 8,
				bias7dPct: -1.2,
			}),
			"Roh 14 kWh · Bias -1,2 % · Ist 8,0 kWh · Abweichung -43 % · stärker daneben als letzte Tage",
		);
		assert.equal(
			ops.visLageLine({
				todayKwh: 18.2,
				tomorrowKwh: 31.4,
				laterKwhs: [8, 7, 6, 9, 8],
				bias7dPct: -14,
				status: "ready",
				minC: 14.2,
				maxC: 22.4,
			}),
			"Heute 18 kWh · Morgen 31 kWh · danach schwächer · 14–22 °C · Bias -14 %",
		);
		assert.equal(ops.visLageLine({}), "");
		assert.match(visHtml, /id="ems-lage"/);
		assert.match(visHtml, /function visLageLine/);
		assert.match(visHtml, /chip\("PV"/);
		assert.match(visHtml, /learning\.pv_bias\.actual_today_kwh/);
		assert.match(visHtml, /learning\.pv_bias\.raw_today_kwh/);
		assert.equal(visHtml.includes("sample_days_30d"), false);
		assert.equal(visHtml.includes("forecast_plan.days_json"), false);
	});
});
