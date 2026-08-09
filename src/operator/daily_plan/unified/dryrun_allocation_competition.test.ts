/**
 * Nachweis (kein Verhaltenswechsel): Dryrun ≠ OFF für Participation.
 * Unified Climate-Input trägt kein live/dryrun-Flag — geplante AC-Nachfrage
 * erhält pv_surplus-Allocation und kann LIVE-IH-Energie konkurrieren.
 * Entscheidung Semantik A vs B offen (siehe Produktantwort).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocateUnifiedDayPlan } from "./allocate";
import { golden001Input } from "./fixtures";
import { buildSlots } from "./fixtures";
import { evaluateParticipation } from "../../contributions/flexible/types";
import { isLiveWriteAllowed } from "../../../execution_mode";

describe("Dryrun AC competition proof (no behavior change)", () => {
	it("participation allows planning when addonExecutionOff=false (dryrun ≠ off)", () => {
		const dryrunLike = evaluateParticipation({
			addonEnabled: true,
			governanceEnabled: true,
			configured: true,
			mappingsReady: true,
			globalModeOff: false,
			addonExecutionOff: false,
			fault: false,
			lockout: false,
		});
		assert.equal(dryrunLike.allowed, true);

		const off = evaluateParticipation({
			addonEnabled: true,
			governanceEnabled: true,
			configured: true,
			mappingsReady: true,
			globalModeOff: false,
			addonExecutionOff: true,
			fault: false,
			lockout: false,
		});
		assert.equal(off.allowed, false);
	});

	it("concrete: climate demand (as dryrun would publish) gets pv_surplus in Unified alongside IH", () => {
		const slots = buildSlots("2026-08-09T10:00:00.000Z", 4);
		const base = golden001Input();
		base.time = {
			...base.time,
			nowIso: "2026-08-09T10:07:00.000Z",
			horizonStartIso: slots[0].startIso,
			horizonEndIso: slots[slots.length - 1].endIso,
			slots,
		};
		base.pv.slots = slots.map((s) => ({
			slot: s,
			forecastPowerW: 2500,
			observedPowerW: null,
			energyKwh: 0.625,
		}));
		base.houseLoad.slots = slots.map((s) => ({
			slot: s,
			forecastPowerW: 800,
			observedPowerW: null,
			energyKwh: 0.2,
		}));
		base.prices.slots = slots.map((s) => ({
			slot: s,
			importCtPerKwh: 20,
			exportCtPerKwh: 8,
			gridImportAllowed: true,
		}));
		base.battery = {
			...base.battery,
			socPct: 100,
			requiredChargeEnergyKwh: 0,
			endSocTargetPct: 100,
			passiveBatteryEnergyAvailable: false,
			dischargeLiveSupported: false,
			maxChargePowerW: 0,
			gridChargeAllowed: false,
		};
		base.thermal = {
			...base.thermal!,
			headroomEnergyKwh: 1.2,
			minPowerW: 1700,
			availablePowerW: 1700,
			deadlineIso: "2026-08-09T14:00:00.000Z",
		};
		base.wallbox = null;

		const withoutAc = allocateUnifiedDayPlan({ ...base, climate: null });
		const withAc = allocateUnifiedDayPlan({
			...base,
			climate: {
				units: [
					{
						unitId: "air_conditioning.unit_1",
						label: "wohn",
						roomTempC: 28,
						comfortMinC: null,
						comfortMaxC: 26,
						targetTempC: 25,
						mandatoryComfort: true,
						expectedEnergyKwh: 1.0,
						typicalPowerW: 900,
						maxShiftHours: 0,
						uncertainty: { status: "valid", confidencePct: 80, reasonDe: "t" },
					},
				],
				freshness: {
					observedAtIso: base.time.nowIso,
					ageSec: 0,
					quality: { status: "valid", confidencePct: 80, reasonDe: "t" },
				},
			},
		});

		const acPv = withAc.allocations.filter(
			(a) => a.kind === "climate" && a.energySource === "pv_surplus",
		);
		assert.ok(acPv.length > 0, "dryrun-like climate demand is allocated from pv_surplus");
		assert.ok(
			withoutAc.allocations.some((a) => a.kind === "immersion_heater"),
			"IH alone is planned",
		);
		assert.ok(
			withAc.allocations.some((a) => a.kind === "immersion_heater"),
			"IH remains in joint plan (competition via shared PV pool / export)",
		);
		const exportWithout = withoutAc.expectedGridExportEnergyKwh ?? 0;
		const exportWith = withAc.expectedGridExportEnergyKwh ?? 0;
		assert.ok(
			exportWith + 1e-6 < exportWithout,
			`climate consumes exportable PV: export ${exportWith} < ${exportWithout}`,
		);
	});

	it("governance writes: global dryrun blocks; live+IH live allows; bat/wb dryrun stay write-blocked", async () => {
		const store = new Map<string, ioBroker.State>([
			["global.execution_mode", { val: "dryrun", ack: true } as ioBroker.State],
			["addons.immersion_heater.mode", { val: "live", ack: true } as ioBroker.State],
			["addons.battery.mode", { val: "dryrun", ack: true } as ioBroker.State],
			["addons.wallbox.mode", { val: "dryrun", ack: true } as ioBroker.State],
		]);
		const get = async (id: string) => store.get(id) ?? null;

		assert.equal(await isLiveWriteAllowed(get, "immersion_heater"), false);
		assert.equal(await isLiveWriteAllowed(get, "battery"), false);
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), false);

		store.set("global.execution_mode", { val: "live", ack: true } as ioBroker.State);
		assert.equal(await isLiveWriteAllowed(get, "immersion_heater"), true);
		assert.equal(await isLiveWriteAllowed(get, "battery"), false);
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), false);
	});
});
