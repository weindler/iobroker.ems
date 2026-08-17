import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { batteryConfigFromAdapter } from "./config.js";
import {
	GRID_BALANCE_EXECUTION_ENABLED,
	classifyGridBalanceEvConflict,
	evaluateGridBalanceSafety,
	type GridBalanceSafetyInput,
} from "./grid_balance_contract.js";
import {
	GRID_BALANCE_DEADBAND_DEFAULT_W,
	GRID_BALANCE_MIN_DURATION_DEFAULT_S,
	adjustConsumptionForEv,
	applyGridBalanceLiveTestPulse,
	consumeGridBalanceLiveTest,
	effectiveGridBalanceMaxW,
	emptyGridBalanceLiveTest,
	emptyStabilization,
	evaluateGridBalanceTick,
	gridBalanceCleanupAllowed,
	gridBalanceSessionReleasePermit,
	gridBalanceSetpointPermit,
	stepStabilization,
	type GridBalanceLiveTestState,
	type GridBalanceTickInput,
} from "./grid_balance_power.js";

const SRC = join(__dirname, "..", "..", "..", "src", "addons", "battery");

function safety(over: Partial<GridBalanceSafetyInput> = {}): GridBalanceSafetyInput {
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
		liveTestPermit: true,
		...over,
	};
}

function consumedLiveTest(nowMs = 8_000): GridBalanceLiveTestState {
	return {
		armed: false,
		consumed: true,
		armedAtMs: 1,
		consumedAtMs: nowMs,
		result: "consumed",
	};
}

function tick(over: Partial<GridBalanceTickInput> = {}): GridBalanceTickInput {
	return {
		nowMs: 10_000,
		safety: safety(),
		consumptionW: 2000,
		pvAcPowerW: 400,
		charging: false,
		chargePowerW: null,
		chargePowerAgeMs: null,
		deadbandW: GRID_BALANCE_DEADBAND_DEFAULT_W,
		minDurationMs: 0,
		offsetW: 25,
		configuredMaxW: 5000,
		hardwareMaxChargeW: 3300,
		hardwareMaxDischargeW: 3300,
		minChangeW: 50,
		lastWrittenW: null,
		ownsSetpoint: false,
		stabilization: emptyStabilization(),
		liveTest: { ...emptyGridBalanceLiveTest(), armed: true },
		controllerIsGridBalance: true,
		forecastBlockReason: "",
		...over,
	};
}

describe("grid balance live hardening v0.1.284", () => {
	it("L1: Admin disabled → kein Write", () => {
		const d = evaluateGridBalanceTick(tick({ safety: safety({ adminEnabled: false, liveTestPermit: true }) }));
		assert.equal(d.shouldWrite, false);
		assert.equal(d.blockReason, "disabled");
	});

	it("L2: Preis > limit → block, kein Median-Bypass", () => {
		const d = evaluateGridBalanceTick(tick({ safety: safety({ priceNowCt: 42, priceLimitCt: 30 }) }));
		assert.equal(d.shouldWrite, false);
		assert.equal(d.priceAllowed, false);
		assert.equal(d.blockReason, "price_above_limit");
	});

	it("L3: Hold planned → block", () => {
		const d = evaluateGridBalanceTick(tick({ safety: safety({ holdPlanned: true }) }));
		assert.equal(d.blockReason, "battery_hold");
		assert.equal(d.shouldWrite, false);
		assert.equal(d.holdDetected, true);
	});

	it("L4: Hold active → block", () => {
		const d = evaluateGridBalanceTick(tick({ safety: safety({ holdActive: true }) }));
		assert.equal(d.blockReason, "battery_hold");
	});

	it("L5: batteryMode=hold → block", () => {
		const d = evaluateGridBalanceTick(tick({ safety: safety({ evccBatteryModeHold: true }) }));
		assert.equal(d.blockReason, "battery_hold");
	});

	it("L6: External Authority → block", () => {
		const d = evaluateGridBalanceTick(
			tick({ safety: safety({ externalEvAuthority: true, evConflictKind: "ev_external" }) }),
		);
		assert.equal(d.blockReason, "external_ev_authority");
		assert.equal(d.shouldRelease, false);
	});

	it("L7: EV NOW → block, nicht als Hauslast", () => {
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
		assert.equal(now.kind, "ev_now");
		const d = evaluateGridBalanceTick(tick({ safety: safety({ evConflictKind: "ev_now" }), charging: true, chargePowerW: 11000, chargePowerAgeMs: 1000 }));
		assert.equal(d.blockReason, "ev_now_grid_charge");
		assert.equal(d.shouldWrite, false);
	});

	it("L8: EV charging + fresh chargePower → Abzug", () => {
		const ev = adjustConsumptionForEv({
			consumptionW: 4000,
			charging: true,
			chargePowerW: 3500,
			chargePowerAgeMs: 2000,
		});
		assert.equal(ev.blockReason, "");
		assert.equal(ev.adjustedConsumptionW, 500);
		const d = evaluateGridBalanceTick(
			tick({
				consumptionW: 4000,
				pvAcPowerW: 0,
				charging: true,
				chargePowerW: 3500,
				chargePowerAgeMs: 2000,
			}),
		);
		assert.equal(d.adjustedConsumptionW, 500);
		assert.equal(d.rawGridDeltaW, 500);
		assert.equal(d.blockReason, "");
		assert.equal(d.shouldWrite, true);
	});

	it("L9: EV charging + stale chargePower → block", () => {
		const ev = adjustConsumptionForEv({
			consumptionW: 4000,
			charging: true,
			chargePowerW: 3500,
			chargePowerAgeMs: 60_000,
		});
		assert.equal(ev.blockReason, "ev_power_unknown");
		const d = evaluateGridBalanceTick(
			tick({ charging: true, chargePowerW: 3500, chargePowerAgeMs: 60_000 }),
		);
		assert.equal(d.blockReason, "ev_power_unknown");
		assert.equal(d.shouldWrite, false);
	});

	it("L10: EV charging + fehlende chargePower → block", () => {
		const d = evaluateGridBalanceTick(tick({ charging: true, chargePowerW: null, chargePowerAgeMs: 500 }));
		assert.equal(d.blockReason, "ev_power_unknown");
		assert.equal(d.shouldWrite, false);
	});

	it("L11: Deadband nicht überschritten → kein Write", () => {
		const d = evaluateGridBalanceTick(tick({ consumptionW: 200, pvAcPowerW: 0, deadbandW: 250 }));
		assert.equal(d.blockReason, "inside_deadband");
		assert.equal(d.shouldWrite, false);
		assert.equal(d.requestedPowerW, 0);
	});

	it("L12: Deadband überschritten, Stabilisierung fehlt → kein Write", () => {
		const d = evaluateGridBalanceTick(
			tick({
				nowMs: 1000,
				minDurationMs: 8000,
				stabilization: emptyStabilization(),
				consumptionW: 2000,
				pvAcPowerW: 0,
			}),
		);
		assert.equal(d.blockReason, "not_stable");
		assert.equal(d.shouldWrite, false);
		assert.ok(d.stabilizationNext.excessSinceMs === 1000);
	});

	it("L13: Stabilisierung erfüllt → eligible", () => {
		const d = evaluateGridBalanceTick(
			tick({
				nowMs: 10_000,
				minDurationMs: 8000,
				stabilization: { excessSinceMs: 1000 },
				consumptionW: 2000,
				pvAcPowerW: 0,
			}),
		);
		assert.equal(d.blockReason, "");
		assert.equal(d.ready, true);
		assert.equal(d.shouldWrite, true);
	});

	it("L14: Maxleistung clamp auf Hardware", () => {
		const max = effectiveGridBalanceMaxW({
			configuredMaxW: 5000,
			hardwareMaxChargeW: 3300,
			hardwareMaxDischargeW: 2800,
		});
		assert.equal(max.configuredMaxW, 5000);
		assert.equal(max.hardwareMaxW, 2800);
		assert.equal(max.effectiveMaxW, 2800);
		const d = evaluateGridBalanceTick(
			tick({ consumptionW: 8000, pvAcPowerW: 0, configuredMaxW: 5000, hardwareMaxDischargeW: 2800 }),
		);
		assert.equal(d.effectiveMaxW, 2800);
		assert.equal(d.requestedPowerW, 2800);
	});

	it("L15: GB Ownership entsteht nur nach eigenem Write", () => {
		const idle = evaluateGridBalanceTick(tick({ ownsSetpoint: false, consumptionW: 100, pvAcPowerW: 0 }));
		assert.equal(idle.ownsSetpointNext, false);
		const written = evaluateGridBalanceTick(tick({ ownsSetpoint: false, consumptionW: 2000, pvAcPowerW: 0 }));
		assert.equal(written.shouldWrite, true);
		assert.equal(written.ownsSetpointNext, true);
	});

	it("L16: Exit ohne Ownership → kein Cleanup-Write", () => {
		const d = evaluateGridBalanceTick(
			tick({
				ownsSetpoint: false,
				safety: safety({ adminEnabled: false, liveTestPermit: true }),
			}),
		);
		assert.equal(d.shouldRelease, false);
		assert.equal(d.shouldWrite, false);
	});

	it("L17: Exit mit Ownership → Release nur wenn erlaubt", () => {
		const ok = evaluateGridBalanceTick(
			tick({
				ownsSetpoint: true,
				safety: safety({ adminEnabled: false, liveTestPermit: true }),
			}),
		);
		assert.equal(ok.shouldRelease, true);
		assert.equal(ok.writePowerW, 0);
		assert.equal(ok.ownsSetpointNext, false);
	});

	it("L18: Hold während GB aktiv → keine konkurrierenden Writes", () => {
		const d = evaluateGridBalanceTick(
			tick({
				ownsSetpoint: true,
				safety: safety({ holdActive: true, liveTestPermit: true }),
			}),
		);
		assert.equal(d.shouldWrite, false);
		assert.equal(d.shouldRelease, false);
		assert.equal(d.blockReason, "battery_hold");
		assert.equal(
			gridBalanceCleanupAllowed({ ownsSetpoint: true, holdDetected: true, authority: "battery_hold" }),
			false,
		);
	});

	it("L19: External übernimmt → kein Cleanup gegen External", () => {
		const d = evaluateGridBalanceTick(
			tick({
				ownsSetpoint: true,
				safety: safety({ externalEvAuthority: true, evConflictKind: "ev_external" }),
			}),
		);
		assert.equal(d.shouldRelease, false);
		assert.equal(d.authority, "external_ev");
	});

	it("L20: kein EVCC/go-e/Ford/Tibber-Direktwrite", () => {
		const src = readFileSync(join(SRC, "grid_balance_power.ts"), "utf8");
		assert.equal(/setForeignStateAsync/.test(src), false);
		assert.equal(/go-e\.|fordpass\.|tibber\.|evcc\./.test(src), false);
	});

	it("L21: 30-ct-Limit nicht umgehbar", () => {
		const d = evaluateGridBalanceTick(tick({ safety: safety({ priceNowCt: 30.1, priceLimitCt: 30 }) }));
		assert.equal(d.blockReason, "price_above_limit");
		assert.equal(batteryConfigFromAdapter({}).gridBalance.maxPriceCtPerKwh, 30);
	});

	it("L22: Mirror/Admin-Gate konsistent — nur Admin zählt", () => {
		const r = evaluateGridBalanceSafety(safety({ adminEnabled: true, emsMirrorEnabled: false, liveTestPermit: true }));
		assert.equal(r.blockReason, "");
		assert.equal(r.policyAllowed, true);
		const cfg = batteryConfigFromAdapter({ bat_feature_grid_balance_enabled: true });
		assert.equal(cfg.gridBalance.enabled, true);
		assert.equal(cfg.gridBalance.deadbandW, GRID_BALANCE_DEADBAND_DEFAULT_W);
		assert.equal(cfg.gridBalance.minDurationSec, GRID_BALANCE_MIN_DURATION_DEFAULT_S);
	});

	it("L23: 0,8-kWh-Mikroregelung liegt im Deadband", () => {
		const d = evaluateGridBalanceTick(tick({ consumptionW: 80, pvAcPowerW: 0, deadbandW: 250 }));
		assert.equal(d.shouldWrite, false);
		assert.equal(d.blockReason, "inside_deadband");
		assert.equal(80 * 24 / 1000 < 2, true);
	});

	it("PV/MIN charging is not an automatic EV conflict", () => {
		const pv = classifyGridBalanceEvConflict({
			loadpointMode: "pv",
			charging: true,
			chargePowerW: 2000,
			wallboxHold: false,
			batteryBoost: false,
			externalAuthority: false,
			tibberRewardsActive: false,
			wallboxEnergySource: "pv",
			wallboxAllocatedGridW: 0,
		});
		assert.equal(pv.conflict, false);
		const min = classifyGridBalanceEvConflict({
			loadpointMode: "min",
			charging: true,
			chargePowerW: 1400,
			wallboxHold: false,
			batteryBoost: false,
			externalAuthority: false,
			tibberRewardsActive: false,
			wallboxEnergySource: "mixed",
			wallboxAllocatedGridW: 0,
		});
		assert.equal(min.conflict, false);
	});

	it("execution stays locked without one-shot", () => {
		assert.equal(GRID_BALANCE_EXECUTION_ENABLED, false);
		const locked = evaluateGridBalanceTick(
			tick({ liveTest: emptyGridBalanceLiveTest(), safety: safety({ liveTestPermit: false }) }),
		);
		assert.equal(locked.shouldWrite, false);
		assert.equal(locked.lastAction, "diagnosis_only");
	});

	it("one-shot session: second setpoint blocked after consume, 0-release still allowed", () => {
		const armed = applyGridBalanceLiveTestPulse(emptyGridBalanceLiveTest(), true, false, 1);
		assert.equal(gridBalanceSetpointPermit(armed), true);
		const first = evaluateGridBalanceTick(tick({ liveTest: armed, consumptionW: 2000, pvAcPowerW: 0 }));
		assert.equal(first.shouldWrite, true);
		assert.equal(first.shouldRelease, false);
		assert.equal(first.ownsSetpointNext, true);
		const consumed = consumeGridBalanceLiveTest(armed, 2);
		assert.equal(gridBalanceSetpointPermit(consumed), false);
		assert.equal(consumed.consumed, true);

		const second = evaluateGridBalanceTick(
			tick({
				liveTest: consumed,
				ownsSetpoint: true,
				lastWrittenW: first.writePowerW,
				consumptionW: 2000,
				pvAcPowerW: 0,
				safety: safety({ liveTestPermit: false }),
			}),
		);
		assert.equal(second.shouldWrite, false);
		assert.equal(second.shouldRelease, false);
		assert.equal(second.ownsSetpointNext, true);

		const release = evaluateGridBalanceTick(
			tick({
				liveTest: consumed,
				ownsSetpoint: true,
				lastWrittenW: first.writePowerW,
				consumptionW: 100,
				pvAcPowerW: 0,
				safety: safety({ liveTestPermit: false }),
			}),
		);
		assert.equal(release.shouldWrite, false);
		assert.equal(release.shouldRelease, true);
		assert.equal(release.writePowerW, 0);
		assert.equal(release.ownsSetpointNext, false);
		assert.equal(
			gridBalanceSessionReleasePermit({
				ownsSetpoint: true,
				holdDetected: false,
				authority: "grid_balance",
				globalLive: true,
				addonLive: true,
				faultActive: false,
				lockoutActive: false,
				restoreInProgress: false,
			}),
			true,
		);
	});

	it("Live→Dryrun with GB ownership: 0-release still allowed", () => {
		assert.equal(
			gridBalanceSessionReleasePermit({
				ownsSetpoint: true,
				holdDetected: false,
				authority: "safety",
				blockReason: "global_dryrun",
				globalLive: false,
				addonLive: true,
				faultActive: false,
				lockoutActive: false,
				restoreInProgress: false,
				leavingLiveWithOwnership: true,
			}),
			true,
		);
		const d = evaluateGridBalanceTick(
			tick({
				ownsSetpoint: true,
				lastWrittenW: 800,
				leavingLiveWithOwnership: true,
				safety: safety({ globalLive: false, liveTestPermit: false }),
			}),
		);
		assert.equal(d.shouldRelease, true);
		assert.equal(d.writePowerW, 0);
		assert.equal(d.ownsSetpointNext, false);
	});

	it("Live→Dryrun + Hold: no competing 0-write", () => {
		const d = evaluateGridBalanceTick(
			tick({
				ownsSetpoint: true,
				lastWrittenW: 800,
				leavingLiveWithOwnership: true,
				safety: safety({ globalLive: false, holdActive: true, liveTestPermit: false }),
			}),
		);
		assert.equal(d.shouldRelease, false);
		assert.equal(d.shouldWrite, false);
		assert.equal(d.ownsSetpointNext, false);
	});

	it("one-shot session: Hold/External/Planned drop ownership without 0-write", () => {
		const consumed = consumedLiveTest();
		const hold = evaluateGridBalanceTick(
			tick({
				liveTest: consumed,
				ownsSetpoint: true,
				lastWrittenW: 800,
				safety: safety({ holdActive: true, liveTestPermit: false }),
			}),
		);
		assert.equal(hold.shouldRelease, false);
		assert.equal(hold.shouldWrite, false);
		assert.equal(hold.ownsSetpointNext, false);

		const ext = evaluateGridBalanceTick(
			tick({
				liveTest: consumed,
				ownsSetpoint: true,
				lastWrittenW: 800,
				safety: safety({ externalEvAuthority: true, evConflictKind: "ev_external", liveTestPermit: false }),
			}),
		);
		assert.equal(ext.shouldRelease, false);
		assert.equal(ext.ownsSetpointNext, false);

		const planned = evaluateGridBalanceTick(
			tick({
				liveTest: consumed,
				ownsSetpoint: true,
				lastWrittenW: 800,
				safety: safety({ plannedBatteryAction: true, liveTestPermit: false }),
			}),
		);
		assert.equal(planned.shouldRelease, false);
		assert.equal(planned.ownsSetpointNext, false);
		assert.equal(planned.authority, "planned_battery");
	});

	it("one-shot pulse arms in-memory only on ack:false", () => {
		const armed = applyGridBalanceLiveTestPulse(emptyGridBalanceLiveTest(), true, false, 5);
		assert.equal(armed.armed, true);
		const ignored = applyGridBalanceLiveTestPulse(emptyGridBalanceLiveTest(), true, true, 5);
		assert.equal(ignored.armed, false);
	});

	it("stabilization resets when load drops into deadband", () => {
		const s = stepStabilization({ excessSinceMs: 1000 }, 5000, false, 8000);
		assert.equal(s.next.excessSinceMs, null);
		assert.equal(s.stable, false);
	});
});
