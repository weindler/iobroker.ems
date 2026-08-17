import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { batteryConfigFromAdapter } from "./config.js";
import { evaluateGridBalanceMinPrice } from "./grid_balance.js";
import { EV_EXECUTION_PHASE5_ENABLED } from "../wallbox/ev_foundation/write_allowlist.js";
import {
	GRID_BALANCE_EXECUTION_ENABLED,
	GRID_BALANCE_MIN_PRICE_DEFAULT_CT,
	classifyGridBalanceEvConflict,
	evaluateGridBalanceSafety,
	formatGridBalanceExplain,
	parseGridBalanceMinPriceCt,
	type GridBalanceSafetyInput,
} from "./grid_balance_contract.js";

const SRC = join(__dirname, "..", "..", "..", "src", "addons", "battery");
const ADMIN_JSON = join(__dirname, "..", "..", "..", "admin", "jsonConfig.json");

function baseSafety(over: Partial<GridBalanceSafetyInput> = {}): GridBalanceSafetyInput {
	return {
		adminEnabled: true,
		emsMirrorEnabled: true,
		globalLive: true,
		addonLive: true,
		addonEnabled: true,
		governanceEnabled: true,
		faultActive: false,
		lockoutActive: false,
		restoreInProgress: false,
		sourceStale: false,
		sourceOffline: false,
		holdPlanned: false,
		holdActive: false,
		evccBatteryModeHold: false,
		plannedBatteryAction: false,
		ownershipActive: false,
		dailyPlanAuthoritative: false,
		mode1Active: false,
		priceNowCt: 50,
		priceMinCt: 30,
		evConflictKind: "",
		externalEvAuthority: false,
		...over,
	};
}

describe("grid balance safety contract v0.1.284", () => {
	it("L1: Netzausgleich default = aus", () => {
		const c = batteryConfigFromAdapter({});
		assert.equal(c.gridBalance.enabled, false);
		assert.equal(GRID_BALANCE_EXECUTION_ENABLED, false);
		assert.equal(EV_EXECUTION_PHASE5_ENABLED, false);
	});

	it("L2: Admin switch is activatable", () => {
		const c = batteryConfigFromAdapter({ bat_feature_grid_balance_enabled: true });
		assert.equal(c.gridBalance.enabled, true);
	});

	it("L3: min price default = 30 ct/kWh", () => {
		const c = batteryConfigFromAdapter({});
		assert.equal(c.gridBalance.minPriceCtPerKwh, GRID_BALANCE_MIN_PRICE_DEFAULT_CT);
		assert.equal(GRID_BALANCE_MIN_PRICE_DEFAULT_CT, 30);
	});

	it("L4: min price is configurable", () => {
		const c = batteryConfigFromAdapter({ bat_grid_balance_min_price_ct_per_kwh: 18.5 });
		assert.equal(c.gridBalance.minPriceCtPerKwh, 18.5);
	});

	it("L5: negative/invalid price values are rejected", () => {
		assert.equal(parseGridBalanceMinPriceCt(-5), 30);
		assert.equal(parseGridBalanceMinPriceCt(Number.NaN), 30);
		assert.equal(parseGridBalanceMinPriceCt("abc"), 30);
		assert.equal(parseGridBalanceMinPriceCt(""), 30);
		assert.equal(parseGridBalanceMinPriceCt(null), 30);
		assert.equal(batteryConfigFromAdapter({ bat_grid_balance_min_price_ct_per_kwh: -10 }).gridBalance.minPriceCtPerKwh, 30);
	});

	it("20 ct → price_allowed=false", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ priceNowCt: 20, priceMinCt: 30 }));
		assert.equal(r.priceAllowed, false);
		assert.equal(r.policyAllowed, false);
		assert.equal(r.blockReason, "price_below_minimum");
		assert.equal(r.explain, "grid_balance=blocked, reason=price_below_minimum");
		assert.equal(r.writeAllowed, false);
	});

	it("29.99 ct → price_allowed=false", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ priceNowCt: 29.99, priceMinCt: 30 }));
		assert.equal(r.priceAllowed, false);
		assert.equal(r.blockReason, "price_below_minimum");
	});

	it("30.0 ct → price_allowed=true", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ priceNowCt: 30, priceMinCt: 30 }));
		assert.equal(r.priceAllowed, true);
		assert.equal(r.policyAllowed, true);
		assert.equal(r.blockReason, "");
	});

	it("36.7 ct → price_allowed=true", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ priceNowCt: 36.7, priceMinCt: 30 }));
		assert.equal(r.priceAllowed, true);
		assert.equal(r.policyAllowed, true);
		assert.match(r.explain, /grid_balance=ready, price=36\.7ct, minimum=30\.0ct/);
	});

	it("50 ct → price_allowed=true", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ priceNowCt: 50, priceMinCt: 30 }));
		assert.equal(r.priceAllowed, true);
		assert.equal(r.blockReason, "");
	});

	it("legacy max-price key 30 migrates to min-price 30", () => {
		const c = batteryConfigFromAdapter({ bat_grid_balance_max_price_ct_per_kwh: 30 });
		assert.equal(c.gridBalance.minPriceCtPerKwh, 30);
	});

	it("new min-price key wins over legacy max-price key", () => {
		const c = batteryConfigFromAdapter({
			bat_grid_balance_max_price_ct_per_kwh: 18,
			bat_grid_balance_min_price_ct_per_kwh: 40,
		});
		assert.equal(c.gridBalance.minPriceCtPerKwh, 40);
	});

	it("L8: hold planned → blocked even at 50 ct", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ holdPlanned: true }));
		assert.equal(r.policyAllowed, false);
		assert.equal(r.holdDetected, true);
		assert.equal(r.blockReason, "battery_hold");
		assert.equal(r.authority, "battery_hold");
	});

	it("L9: hold active → blocked", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ holdActive: true }));
		assert.equal(r.blockReason, "battery_hold");
		assert.equal(r.holdDetected, true);
		assert.equal(evaluateGridBalanceSafety(baseSafety({ evccBatteryModeHold: true })).blockReason, "battery_hold");
	});

	it("L10: external EV authority → blocked even at 50 ct", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ externalEvAuthority: true, evConflictKind: "ev_external" }));
		assert.equal(r.blockReason, "external_ev_authority");
		assert.equal(r.authority, "external_ev");
		assert.equal(r.explain, "grid_balance=blocked, reason=external_ev_authority");
	});

	it("L11: EV NOW / grid charge is not treated as house load", () => {
		const now = classifyGridBalanceEvConflict({
			loadpointMode: "now",
			charging: true,
			chargePowerW: 11000,
			wallboxHold: false,
			batteryBoost: false,
			externalAuthority: false,
			tibberRewardsActive: false,
			wallboxEnergySource: "grid",
			wallboxAllocatedGridW: 11000,
		});
		assert.equal(now.conflict, true);
		assert.equal(now.kind, "ev_now");
		const r = evaluateGridBalanceSafety(baseSafety({ evConflictKind: "ev_now" }));
		assert.equal(r.blockReason, "ev_now_grid_charge");
		assert.equal(r.evConflict, true);
		assert.equal(r.writeAllowed, false);
	});

	it("L11b: disconnected leftover now is not an EV conflict", () => {
		const leftover = classifyGridBalanceEvConflict({
			loadpointMode: "now",
			charging: false,
			chargePowerW: 0,
			wallboxHold: true,
			batteryBoost: true,
			externalAuthority: false,
			tibberRewardsActive: false,
			wallboxEnergySource: "none",
			wallboxAllocatedGridW: 0,
			vehicleConnected: false,
		});
		assert.equal(leftover.conflict, false);
		assert.equal(leftover.kind, "");
	});

	it("L12: planned battery action has priority", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ plannedBatteryAction: true }));
		assert.equal(r.blockReason, "planned_battery_action");
		assert.equal(r.authority, "planned_battery");
	});

	it("L13: fault/restore has priority", () => {
		assert.equal(evaluateGridBalanceSafety(baseSafety({ restoreInProgress: true })).blockReason, "restore_in_progress");
		assert.equal(evaluateGridBalanceSafety(baseSafety({ faultActive: true })).blockReason, "fault_lockout");
		assert.equal(evaluateGridBalanceSafety(baseSafety({ restoreInProgress: true, holdActive: true })).authority, "safety");
	});

	it("L14: global dryrun → no productive writes", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ globalLive: false }));
		assert.equal(r.writeAllowed, false);
		assert.equal(r.blockReason, "global_dryrun");
	});

	it("L15: battery add-on dryrun → no productive writes", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ addonLive: false }));
		assert.equal(r.writeAllowed, false);
		assert.equal(r.blockReason, "addon_dryrun");
	});

	it("L16: disabled → no productive writes", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ adminEnabled: false }));
		assert.equal(r.writeAllowed, false);
		assert.equal(r.blockReason, "disabled");
		assert.equal(r.explain, "grid_balance=blocked, reason=disabled");
	});

	it("L17: no new direct EVCC / go-e / Ford / Tibber write", () => {
		const contractSrc = readFileSync(join(SRC, "grid_balance_contract.ts"), "utf8");
		const gbSrc = readFileSync(join(SRC, "grid_balance.ts"), "utf8");
		for (const src of [contractSrc, gbSrc]) {
			assert.equal(/setForeignStateAsync/.test(src), false);
			assert.equal(/go-e\.|fordpass\.|tibber\.|evcc\./.test(src), false);
		}
		assert.equal(GRID_BALANCE_EXECUTION_ENABLED, false);
		assert.equal(EV_EXECUTION_PHASE5_ENABLED, false);
	});

	it("L18: execution stays locked even when policy would allow", () => {
		const r = evaluateGridBalanceSafety(baseSafety());
		assert.equal(r.policyAllowed, true);
		assert.equal(r.ready, true);
		assert.equal(r.writeAllowed, false);
		assert.equal(GRID_BALANCE_EXECUTION_ENABLED, false);
		assert.match(r.explain, /grid_balance=ready/);
	});

	it("one-shot permit unlocks writes without Dauerbetrieb flag", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ liveTestPermit: true }));
		assert.equal(GRID_BALANCE_EXECUTION_ENABLED, false);
		assert.equal(r.policyAllowed, true);
		assert.equal(r.writeAllowed, true);
	});

	it("admin switch is the only feature gate — mirror off does not block", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ adminEnabled: true, emsMirrorEnabled: false }));
		assert.equal(r.blockReason, "");
		assert.equal(r.policyAllowed, true);
	});

	it("no median / relative price gate in grid-balance contract", () => {
		const contractSrc = readFileSync(join(SRC, "grid_balance_contract.ts"), "utf8");
		const gbSrc = readFileSync(join(SRC, "grid_balance.ts"), "utf8");
		const cfgSrc = readFileSync(join(SRC, "config.ts"), "utf8");
		for (const src of [contractSrc, gbSrc, cfgSrc]) {
			assert.equal(/priceMedianFactor|medianFactor|Median×|price_median_factor/.test(src), false);
			assert.equal(/price_above_limit/.test(src), false);
			assert.equal(/bat_grid_balance_price_gate_enabled/.test(src), false);
		}
		const r = evaluateGridBalanceMinPrice({ minPriceCtPerKwh: 30, priceNowCt: 42 });
		assert.equal(r.passed, true);
	});

	it("explain active uses Mode-2 discharge, never charge", () => {
		assert.equal(
			formatGridBalanceExplain({
				enabled: true,
				blockReason: "",
				priceNowCt: 36.7,
				priceMinCt: 30,
				gridImportW: 48,
				active: true,
				mode2Confirmed: true,
				dischargeW: 48,
			}),
			"grid_balance=active, mode=2, discharge=48W",
		);
		assert.equal(
			formatGridBalanceExplain({
				enabled: true,
				blockReason: "battery_hold",
				priceNowCt: 36.7,
				priceMinCt: 30,
				gridImportW: 48,
			}),
			"grid_balance=blocked, reason=battery_hold",
		);
	});

	it("explain ready includes price, minimum and grid import", () => {
		assert.equal(
			formatGridBalanceExplain({
				enabled: true,
				blockReason: "",
				priceNowCt: 36.7,
				priceMinCt: 30,
				gridImportW: 850,
			}),
			"grid_balance=ready, price=36.7ct, minimum=30.0ct, grid_import=850W",
		);
	});

	it("admin jsonConfig has min price and dropped price-gate/median fields", () => {
		const cfg = readFileSync(ADMIN_JSON, "utf8");
		assert.equal(/bat_grid_balance_price_gate_enabled/.test(cfg), false);
		assert.equal(/bat_grid_balance_price_median_factor/.test(cfg), false);
		assert.equal(/Preisgate aktiv/.test(cfg), false);
		assert.equal(/Preis relativ/.test(cfg), false);
		assert.equal(/bat_grid_balance_max_price_ct_per_kwh/.test(cfg), false);
		assert.match(cfg, /bat_grid_balance_min_price_ct_per_kwh/);
		assert.match(cfg, /Mindeststrompreis für Netzausgleich/);
		assert.match(cfg, /bat_feature_grid_balance_enabled/);
		assert.match(cfg, /bat_offset_soc_threshold_pct/);
		assert.match(cfg, /bat_offset_high_soc_w/);
		assert.match(cfg, /bat_offset_low_soc_w/);
		assert.match(cfg, /bat_grid_balance_min_change_w/);
		assert.match(cfg, /bat_grid_balance_deadband_w/);
		assert.equal(/bat_grid_balance_min_duration_s/.test(cfg), false);
		assert.match(cfg, /bat_battery_discharging_target/);
		assert.match(cfg, /control\.discharge/);
		assert.match(cfg, /"bat_grid_balance_deadband_w"[\s\S]*?"default": 0/);
		assert.match(cfg, /bat_grid_balance_max_w/);
		assert.match(cfg, /bat_grid_balance_update_interval_sec/);
	});
});
