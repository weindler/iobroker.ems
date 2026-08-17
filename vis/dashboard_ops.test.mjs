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

function extractScript(html) {
	const start = html.indexOf("<script>");
	const end = html.lastIndexOf("</script>");
	assert.ok(start >= 0 && end > start, "ems-charts.html must contain a script block");
	return html.slice(start + "<script>".length, end);
}

const REQUIRED_STATE_PATHS = [
	"operator.vis.price_timeline_json",
	"live.pv.power_w",
	"live.battery.house_load_w",
	"live.battery.soc_pct",
	"live.price.now_ct_per_kwh",
	"addons.battery.telemetry.charging_power_w",
	"addons.battery.telemetry.discharging_power_w",
	"addons.battery.runtime.battery_setpoint_owner",
	"addons.battery.grid_balance.enabled",
	"addons.battery.grid_balance.active",
	"addons.battery.grid_balance.ready",
	"addons.battery.grid_balance.block_reason",
	"addons.battery.grid_balance.price_allowed",
	"addons.battery.grid_balance.price_min_ct_kwh",
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
	});

	it("does not put long Newton/planner explain text in the live header", () => {
		assert.equal(/ems-now[\s\S]{0,200}cooling_k_per_h/.test(visHtml), false);
		assert.match(visHtml, /sammelt Daten/);
		assert.match(visHtml, /belastbar/);
	});
});
