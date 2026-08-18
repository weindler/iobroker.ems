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
	GRID_BALANCE_KEEPALIVE_MAX_MS,
	adjustConsumptionForEv,
	applyGridBalanceLiveTestPulse,
	consumeGridBalanceLiveTest,
	effectiveGridBalanceMaxW,
	emptyGridBalanceLiveTest,
	evaluateGridBalanceTick,
	gridBalanceCleanupAllowed,
	gridBalanceSessionReleasePermit,
	gridBalanceSetpointPermit,
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
		priceNowCt: 50,
		priceMinCt: 30,
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
		offsetW: 25,
		configuredMaxW: 5000,
		hardwareMaxChargeW: 3300,
		hardwareMaxDischargeW: 3300,
		minChangeW: 50,
		lastWrittenW: null,
		lastWriteAtMs: null,
		ownsSetpoint: false,
		liveTest: { ...emptyGridBalanceLiveTest(), armed: true },
		controllerIsGridBalance: true,
		mode2Confirmed: true,
		keepaliveMaxMs: GRID_BALANCE_KEEPALIVE_MAX_MS,
		...over,
	};
}

describe("grid balance live hardening v0.1.289", () => {
	it("L1: Admin disabled → kein Write", () => {
		const d = evaluateGridBalanceTick(tick({ safety: safety({ adminEnabled: false, liveTestPermit: true }) }));
		assert.equal(d.shouldWrite, false);
		assert.equal(d.blockReason, "disabled");
	});

	it("L2: Preis unter Mindestpreis → kein discharge", () => {
		const d = evaluateGridBalanceTick(tick({ safety: safety({ priceNowCt: 20, priceMinCt: 30 }) }));
		assert.equal(d.shouldWrite, false);
		assert.equal(d.priceAllowed, false);
		assert.equal(d.blockReason, "price_below_minimum");
		assert.equal(d.writeKind, "discharge");
		assert.match(d.explain, /reason=price_below_minimum/);
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
		const d = evaluateGridBalanceTick(
			tick({ safety: safety({ evConflictKind: "ev_now" }), charging: true, chargePowerW: 11000, chargePowerAgeMs: 1000 }),
		);
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
		assert.equal(d.writeKind, "discharge");
	});

	it("L8b: disconnected leftover charging/power is not house-load EV", () => {
		const ev = adjustConsumptionForEv({
			consumptionW: 4000,
			charging: true,
			chargePowerW: 3500,
			chargePowerAgeMs: 2000,
			vehicleConnected: false,
		});
		assert.equal(ev.evActive, false);
		assert.equal(ev.adjustedConsumptionW, 4000);
		assert.equal(ev.blockReason, "");
		const d = evaluateGridBalanceTick(
			tick({
				consumptionW: 4000,
				pvAcPowerW: 0,
				charging: true,
				chargePowerW: 3500,
				chargePowerAgeMs: 2000,
				vehicleConnected: false,
			}),
		);
		assert.equal(d.adjustedConsumptionW, 4000);
		assert.notEqual(d.blockReason, "ev_power_unknown");
	});

	it("L9: EV charging + stale chargePower → block", () => {
		const ev = adjustConsumptionForEv({
			consumptionW: 4000,
			charging: true,
			chargePowerW: 3500,
			chargePowerAgeMs: 60_000,
		});
		assert.equal(ev.blockReason, "ev_power_unknown");
		const d = evaluateGridBalanceTick(tick({ charging: true, chargePowerW: 3500, chargePowerAgeMs: 60_000 }));
		assert.equal(d.blockReason, "ev_power_unknown");
		assert.equal(d.shouldWrite, false);
	});

	it("L10: EV charging + fehlende chargePower → block", () => {
		const d = evaluateGridBalanceTick(tick({ charging: true, chargePowerW: null, chargePowerAgeMs: 500 }));
		assert.equal(d.blockReason, "ev_power_unknown");
		assert.equal(d.shouldWrite, false);
	});

	it("L11: optionales Deadband 250 W blockiert kleinen Restbezug", () => {
		const d = evaluateGridBalanceTick(tick({ consumptionW: 200, pvAcPowerW: 0, deadbandW: 250, offsetW: 0 }));
		assert.equal(d.blockReason, "inside_deadband");
		assert.equal(d.shouldWrite, false);
		assert.equal(d.requestedPowerW, 0);
	});

	it("L12: keine 8-s-Stabilisierung — Telemetriepunkt schreibt sofort", () => {
		const d = evaluateGridBalanceTick(
			tick({
				nowMs: 1000,
				consumptionW: 2000,
				pvAcPowerW: 0,
			}),
		);
		assert.equal(d.blockReason, "");
		assert.equal(d.shouldWrite, true);
		assert.equal(d.writeKind, "discharge");
		assert.equal("stabilizationNext" in d, false);
	});

	it("L14: Maxleistung clamp auf Hardware-Discharge", () => {
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
		assert.equal(d.writeKind, "discharge");
	});

	it("L15: GB Ownership entsteht nur nach eigenem Write", () => {
		const idle = evaluateGridBalanceTick(tick({ ownsSetpoint: false, consumptionW: 100, pvAcPowerW: 100, offsetW: 0 }));
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

	it("L17: reguläres GB-Ende mit Ownership → genau ein discharge=0", () => {
		const ok = evaluateGridBalanceTick(
			tick({
				ownsSetpoint: true,
				lastWrittenW: 800,
				lastWriteAtMs: 1000,
				safety: safety({ adminEnabled: false, liveTestPermit: true }),
			}),
		);
		assert.equal(ok.shouldRelease, true);
		assert.equal(ok.writePowerW, 0);
		assert.equal(ok.writeKind, "discharge");
		assert.equal(ok.ownsSetpointNext, false);
	});

	it("L18: Hold während GB aktiv → sofort discharge=0, keine Keepalives", () => {
		const d = evaluateGridBalanceTick(
			tick({
				ownsSetpoint: true,
				lastWrittenW: 800,
				lastWriteAtMs: 1000,
				safety: safety({ holdActive: true, liveTestPermit: true }),
			}),
		);
		assert.equal(d.shouldWrite, false);
		assert.equal(d.shouldRelease, true);
		assert.equal(d.writePowerW, 0);
		assert.equal(d.ownsSetpointNext, false);
		assert.equal(d.keepaliveDue, false);
		assert.equal(d.blockReason, "battery_hold");
		assert.equal(
			gridBalanceCleanupAllowed({ ownsSetpoint: true, holdDetected: true, authority: "battery_hold" }),
			true,
		);
	});

	it("L19: External übernimmt → GB endet mit discharge=0, danach Mode-Wechsel", () => {
		const d = evaluateGridBalanceTick(
			tick({
				ownsSetpoint: true,
				lastWrittenW: 800,
				safety: safety({ externalEvAuthority: true, evConflictKind: "ev_external" }),
			}),
		);
		assert.equal(d.shouldRelease, true);
		assert.equal(d.writePowerW, 0);
		assert.equal(d.shouldWrite, false);
		assert.equal(d.keepaliveDue, false);
		assert.equal(d.authority, "external_ev");
	});

	it("L20: kein EVCC/go-e/Ford/Tibber-Direktwrite", () => {
		for (const file of ["grid_balance_power.ts", "grid_balance.ts", "grid_balance_contract.ts", "index.ts"]) {
			const src = readFileSync(join(SRC, file), "utf8");
			assert.equal(/go-e\.|fordpass\.|tibber\.|evcc\./.test(src), false, file);
		}
		assert.equal(/setForeignStateAsync/.test(readFileSync(join(SRC, "grid_balance_power.ts"), "utf8")), false);
	});

	it("L21: 30-ct-Mindestpreis nicht unterschreitbar", () => {
		const d = evaluateGridBalanceTick(tick({ safety: safety({ priceNowCt: 29.99, priceMinCt: 30 }) }));
		assert.equal(d.blockReason, "price_below_minimum");
		assert.equal(batteryConfigFromAdapter({}).gridBalance.minPriceCtPerKwh, 30);
	});

	it("L22: Default Deadband = 0, keine minDuration", () => {
		const r = evaluateGridBalanceSafety(safety({ adminEnabled: true, emsMirrorEnabled: false, liveTestPermit: true }));
		assert.equal(r.blockReason, "");
		assert.equal(r.policyAllowed, true);
		const cfg = batteryConfigFromAdapter({ bat_feature_grid_balance_enabled: true });
		assert.equal(cfg.gridBalance.enabled, true);
		assert.equal(cfg.gridBalance.deadbandW, 0);
		assert.equal(GRID_BALANCE_DEADBAND_DEFAULT_W, 0);
		assert.equal("minDurationSec" in cfg.gridBalance, false);
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

	it("Dauerbetrieb writes without one-shot", () => {
		assert.equal(GRID_BALANCE_EXECUTION_ENABLED, true);
		const d = evaluateGridBalanceTick(
			tick({ liveTest: emptyGridBalanceLiveTest(), safety: safety({ liveTestPermit: false }) }),
		);
		assert.equal(d.shouldWrite, true);
		assert.equal(d.lastAction, "written");
		assert.equal(d.writeKind, "discharge");
	});

	it("one-shot session: keepalive and 0-release still work under Dauerbetrieb", () => {
		const armed = applyGridBalanceLiveTestPulse(emptyGridBalanceLiveTest(), true, false, 1);
		assert.equal(gridBalanceSetpointPermit(armed), true);
		const first = evaluateGridBalanceTick(tick({ liveTest: armed, consumptionW: 2000, pvAcPowerW: 0 }));
		assert.equal(first.shouldWrite, true);
		assert.equal(first.shouldRelease, false);
		assert.equal(first.ownsSetpointNext, true);
		assert.equal(first.writeKind, "discharge");
		const consumed = consumeGridBalanceLiveTest(armed, 2);
		assert.equal(gridBalanceSetpointPermit(consumed), true);
		assert.equal(gridBalanceSetpointPermit(consumed, true), true);
		assert.equal(consumed.consumed, true);

		const sameWIdle = evaluateGridBalanceTick(
			tick({
				nowMs: 10_000,
				liveTest: consumed,
				ownsSetpoint: true,
				lastWrittenW: first.writePowerW,
				lastWriteAtMs: 10_000,
				consumptionW: 2000,
				pvAcPowerW: 0,
				safety: safety({ liveTestPermit: false }),
			}),
		);
		assert.equal(sameWIdle.shouldWrite, false);
		assert.equal(sameWIdle.keepaliveDue, false);
		assert.equal(sameWIdle.ownsSetpointNext, true);

		const keepalive = evaluateGridBalanceTick(
			tick({
				nowMs: 18_000,
				liveTest: consumed,
				ownsSetpoint: true,
				lastWrittenW: first.writePowerW,
				lastWriteAtMs: 10_000,
				consumptionW: 2000,
				pvAcPowerW: 0,
				safety: safety({ liveTestPermit: false }),
			}),
		);
		assert.equal(keepalive.shouldWrite, true);
		assert.equal(keepalive.lastAction, "keepalive");
		assert.equal(keepalive.forceWrite, true);
		assert.equal(keepalive.writePowerW, first.writePowerW);

		const release = evaluateGridBalanceTick(
			tick({
				liveTest: consumed,
				ownsSetpoint: true,
				lastWrittenW: first.writePowerW,
				consumptionW: 100,
				pvAcPowerW: 100,
				offsetW: 0,
				safety: safety({ liveTestPermit: false }),
			}),
		);
		assert.equal(release.shouldWrite, false);
		assert.equal(release.shouldRelease, true);
		assert.equal(release.writePowerW, 0);
		assert.equal(release.writeKind, "discharge");
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

	it("Live→Dryrun + Hold: GB endet mit discharge=0", () => {
		const d = evaluateGridBalanceTick(
			tick({
				ownsSetpoint: true,
				lastWrittenW: 800,
				leavingLiveWithOwnership: true,
				safety: safety({ globalLive: false, holdActive: true, liveTestPermit: false }),
			}),
		);
		assert.equal(d.shouldRelease, true);
		assert.equal(d.writePowerW, 0);
		assert.equal(d.shouldWrite, false);
		assert.equal(d.ownsSetpointNext, false);
	});

	it("one-shot session: Hold/External/Planned end GB with discharge=0 before mode switch", () => {
		const consumed = consumedLiveTest();
		const hold = evaluateGridBalanceTick(
			tick({
				liveTest: consumed,
				ownsSetpoint: true,
				lastWrittenW: 800,
				safety: safety({ holdActive: true, liveTestPermit: false }),
			}),
		);
		assert.equal(hold.shouldRelease, true);
		assert.equal(hold.writePowerW, 0);
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
		assert.equal(ext.shouldRelease, true);
		assert.equal(ext.writePowerW, 0);
		assert.equal(ext.ownsSetpointNext, false);

		const planned = evaluateGridBalanceTick(
			tick({
				liveTest: consumed,
				ownsSetpoint: true,
				lastWrittenW: 800,
				safety: safety({ plannedBatteryAction: true, liveTestPermit: false }),
			}),
		);
		assert.equal(planned.shouldRelease, true);
		assert.equal(planned.writePowerW, 0);
		assert.equal(planned.ownsSetpointNext, false);
		assert.equal(planned.authority, "planned_battery");
	});

	it("one-shot pulse arms in-memory only on ack:false", () => {
		const armed = applyGridBalanceLiveTestPulse(emptyGridBalanceLiveTest(), true, false, 5);
		assert.equal(armed.armed, true);
		const ignored = applyGridBalanceLiveTestPulse(emptyGridBalanceLiveTest(), true, true, 5);
		assert.equal(ignored.armed, false);
	});
});

describe("grid balance Mode-2 discharge contract v0.1.289", () => {
	it("writes only discharge, never charge, never Mode 1", () => {
		const d = evaluateGridBalanceTick(tick({ consumptionW: 188, pvAcPowerW: 140, offsetW: 0 }));
		assert.equal(d.writeKind, "discharge");
		assert.equal(d.shouldWrite, true);
		assert.equal(d.mode2Confirmed, true);
		const powerSrc = readFileSync(join(SRC, "grid_balance_power.ts"), "utf8");
		const idx = readFileSync(join(SRC, "index.ts"), "utf8");
		assert.equal(/writeKind: "charge"/.test(powerSrc), false);
		assert.match(idx, /kind: "discharge_power"/);
		assert.match(idx, /table\.set_discharge_power\.targetState/);
		assert.equal(/const gbState = table\.set_charge_power/.test(idx), false);
		assert.equal(/gridBalanceStabilization|minDurationMs|emptyStabilization/.test(idx), false);
		assert.equal(/GRID_BALANCE_KEEPALIVE_MAX_MS/.test(idx), true);
	});

	it("48 W Restnetzbezug → erster discharge-Write 48 W", () => {
		const d = evaluateGridBalanceTick(
			tick({ consumptionW: 188, pvAcPowerW: 140, offsetW: 0, minChangeW: 50, ownsSetpoint: false, lastWrittenW: null }),
		);
		assert.equal(d.rawGridDeltaW, 48);
		assert.equal(d.requestedPowerW, 48);
		assert.equal(d.shouldWrite, true);
		assert.equal(d.writePowerW, 48);
		assert.equal(d.forceWrite, true);
		assert.equal(d.lastAction, "written");
		assert.match(d.explain, /discharge=48W/);
	});

	it("20 W Restnetzbezug → grundsätzlich möglich", () => {
		const d = evaluateGridBalanceTick(tick({ consumptionW: 160, pvAcPowerW: 140, offsetW: 0, minChangeW: 50 }));
		assert.equal(d.rawGridDeltaW, 20);
		assert.equal(d.requestedPowerW, 20);
		assert.equal(d.shouldWrite, true);
		assert.equal(d.writePowerW, 20);
	});

	it("erster kleiner Sollwert wird nicht von Write-Hysterese blockiert", () => {
		const d = evaluateGridBalanceTick(
			tick({
				consumptionW: 188,
				pvAcPowerW: 140,
				offsetW: 0,
				minChangeW: 50,
				ownsSetpoint: false,
				lastWrittenW: null,
			}),
		);
		assert.equal(d.shouldWrite, true);
		assert.equal(d.writePowerW, 48);
	});

	it("Write-Hysterese filtert nur Änderungen eines aktiven Setpoints", () => {
		const d = evaluateGridBalanceTick(
			tick({
				nowMs: 10_000,
				consumptionW: 165,
				pvAcPowerW: 0,
				offsetW: 0,
				minChangeW: 50,
				ownsSetpoint: true,
				lastWrittenW: 150,
				lastWriteAtMs: 10_000,
			}),
		);
		assert.equal(d.requestedPowerW, 165);
		assert.equal(d.shouldWrite, false);
		assert.equal(d.effectivePowerW, 150);
	});

	it("Keepalive desselben Setpoints wird nicht von Hysterese blockiert", () => {
		const d = evaluateGridBalanceTick(
			tick({
				nowMs: 18_000,
				consumptionW: 150,
				pvAcPowerW: 0,
				offsetW: 0,
				minChangeW: 50,
				ownsSetpoint: true,
				lastWrittenW: 150,
				lastWriteAtMs: 10_000,
			}),
		);
		assert.equal(d.keepaliveDue, true);
		assert.equal(d.shouldWrite, true);
		assert.equal(d.forceWrite, true);
		assert.equal(d.writePowerW, 150);
		assert.equal(d.lastAction, "keepalive");
		assert.equal(GRID_BALANCE_KEEPALIVE_MAX_MS, 8000);
	});

	it("Mode 2 nicht bestätigt → kein discharge", () => {
		const d = evaluateGridBalanceTick(tick({ mode2Confirmed: false, consumptionW: 2000, pvAcPowerW: 0 }));
		assert.equal(d.shouldWrite, false);
		assert.equal(d.blockReason, "mode_not_self_consumption");
	});

	it("Haus 200 W / PV 0 → Entladeziel 200 W (nicht 30 W Smartmeter-Rest)", () => {
		const d = evaluateGridBalanceTick(tick({ consumptionW: 200, pvAcPowerW: 0, offsetW: 0 }));
		assert.equal(d.rawGridDeltaW, 200);
		assert.equal(d.requestedPowerW, 200);
		assert.equal(d.shouldWrite, true);
		assert.equal(d.writePowerW, 200);
		assert.equal(d.writeKind, "discharge");
	});

	it("Restore/Fault: kein GB-0 gegen Safety", () => {
		assert.equal(
			gridBalanceCleanupAllowed({
				ownsSetpoint: true,
				holdDetected: false,
				authority: "safety",
				blockReason: "restore_in_progress",
			}),
			false,
		);
		assert.equal(
			gridBalanceCleanupAllowed({
				ownsSetpoint: true,
				holdDetected: false,
				authority: "safety",
				blockReason: "fault_lockout",
			}),
			false,
		);
	});

	it("power module has no 8 s stabilization", () => {
		const src = readFileSync(join(SRC, "grid_balance_power.ts"), "utf8");
		assert.equal(/not_stable|stepStabilization|emptyStabilization|minDurationMs/.test(src), false);
		assert.equal(/GRID_BALANCE_MIN_DURATION/.test(src), false);
	});
});
