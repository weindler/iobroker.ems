import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { batteryConfigFromAdapter } from "./config.js";
import { evaluateGridBalancePriceGate } from "./grid_balance.js";
import {
	GRID_BALANCE_EXECUTION_ENABLED,
	GRID_BALANCE_MAX_PRICE_DEFAULT_CT,
	classifyGridBalanceEvConflict,
	evaluateGridBalanceSafety,
	formatGridBalanceExplain,
	parseGridBalanceMaxPriceCt,
	type GridBalanceSafetyInput,
} from "./grid_balance_contract.js";

const SRC = join(__dirname, "..", "..", "..", "src", "addons", "battery");

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
		priceNowCt: 22,
		priceLimitCt: 30,
		priceGateEnabled: true,
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
	});

	it("L2: Admin switch is activatable", () => {
		const c = batteryConfigFromAdapter({ bat_feature_grid_balance_enabled: true });
		assert.equal(c.gridBalance.enabled, true);
	});

	it("L3: price limit default = 30 ct/kWh", () => {
		const c = batteryConfigFromAdapter({});
		assert.equal(c.gridBalance.maxPriceCtPerKwh, GRID_BALANCE_MAX_PRICE_DEFAULT_CT);
		assert.equal(GRID_BALANCE_MAX_PRICE_DEFAULT_CT, 30);
	});

	it("L4: price limit is configurable", () => {
		const c = batteryConfigFromAdapter({ bat_grid_balance_max_price_ct_per_kwh: 18.5 });
		assert.equal(c.gridBalance.maxPriceCtPerKwh, 18.5);
	});

	it("L5: negative/invalid price values are rejected", () => {
		assert.equal(parseGridBalanceMaxPriceCt(-5), 30);
		assert.equal(parseGridBalanceMaxPriceCt(Number.NaN), 30);
		assert.equal(parseGridBalanceMaxPriceCt("abc"), 30);
		assert.equal(parseGridBalanceMaxPriceCt(""), 30);
		assert.equal(parseGridBalanceMaxPriceCt(null), 30);
		assert.equal(batteryConfigFromAdapter({ bat_grid_balance_max_price_ct_per_kwh: -10 }).gridBalance.maxPriceCtPerKwh, 30);
	});

	it("L6: price > limit → blocked", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ priceNowCt: 42.1, priceLimitCt: 30 }));
		assert.equal(r.policyAllowed, false);
		assert.equal(r.priceAllowed, false);
		assert.equal(r.blockReason, "price_above_limit");
		assert.equal(r.explain, "grid_balance=blocked, price=42.1ct, limit=30.0ct");
		assert.equal(r.writeAllowed, false);
	});

	it("L7: price <= limit → price allowed", () => {
		const r = evaluateGridBalanceSafety(baseSafety({ priceNowCt: 30, priceLimitCt: 30 }));
		assert.equal(r.priceAllowed, true);
		assert.equal(r.policyAllowed, true);
		assert.equal(r.blockReason, "");
	});

	it("L8: hold planned → blocked", () => {
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

	it("L10: external EV authority → blocked", () => {
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

	it("absolute max price cannot be bypassed by median", () => {
		const r = evaluateGridBalancePriceGate({
			gate: { enabled: true, maxPriceCtPerKwh: 30, medianFactor: 1.05 },
			priceNowCt: 42,
			referenceMedianCt: 50,
		});
		assert.equal(r.passed, false);
	});

	it("explain ready includes grid import", () => {
		assert.equal(
			formatGridBalanceExplain({
				enabled: true,
				blockReason: "",
				priceNowCt: 22,
				priceLimitCt: 30,
				gridImportW: 850,
			}),
			"grid_balance=ready, grid_import=850W",
		);
	});
});
