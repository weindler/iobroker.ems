"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Nachweis (kein Verhaltenswechsel): Dryrun ≠ OFF für Participation.
 * Unified Climate-Input trägt kein live/dryrun-Flag — geplante AC-Nachfrage
 * erhält pv_surplus-Allocation und kann LIVE-IH-Energie konkurrieren.
 * Entscheidung Semantik A vs B offen (siehe Produktantwort).
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const fixtures_2 = require("./fixtures");
const types_1 = require("../../contributions/flexible/types");
const execution_mode_1 = require("../../../execution_mode");
(0, node_test_1.describe)("Dryrun AC competition proof (no behavior change)", () => {
    (0, node_test_1.it)("participation allows planning when addonExecutionOff=false (dryrun ≠ off)", () => {
        const dryrunLike = (0, types_1.evaluateParticipation)({
            addonEnabled: true,
            governanceEnabled: true,
            configured: true,
            mappingsReady: true,
            globalModeOff: false,
            addonExecutionOff: false,
            fault: false,
            lockout: false,
        });
        strict_1.default.equal(dryrunLike.allowed, true);
        const off = (0, types_1.evaluateParticipation)({
            addonEnabled: true,
            governanceEnabled: true,
            configured: true,
            mappingsReady: true,
            globalModeOff: false,
            addonExecutionOff: true,
            fault: false,
            lockout: false,
        });
        strict_1.default.equal(off.allowed, false);
    });
    (0, node_test_1.it)("concrete: climate demand (as dryrun would publish) gets pv_surplus in Unified alongside IH", () => {
        const slots = (0, fixtures_2.buildSlots)("2026-08-09T10:00:00.000Z", 4);
        const base = (0, fixtures_1.golden001Input)();
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
            ...base.thermal,
            headroomEnergyKwh: 1.2,
            minPowerW: 1700,
            availablePowerW: 1700,
            deadlineIso: "2026-08-09T14:00:00.000Z",
        };
        base.wallbox = null;
        const withoutAc = (0, allocate_1.allocateUnifiedDayPlan)({ ...base, climate: null });
        const withAc = (0, allocate_1.allocateUnifiedDayPlan)({
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
        const acPv = withAc.allocations.filter((a) => a.kind === "climate" && a.energySource === "pv_surplus");
        strict_1.default.ok(acPv.length > 0, "dryrun-like climate demand is allocated from pv_surplus");
        strict_1.default.ok(withoutAc.allocations.some((a) => a.kind === "immersion_heater"), "IH alone is planned");
        strict_1.default.ok(withAc.allocations.some((a) => a.kind === "immersion_heater"), "IH remains in joint plan (competition via shared PV pool / export)");
        const exportWithout = withoutAc.expectedGridExportEnergyKwh ?? 0;
        const exportWith = withAc.expectedGridExportEnergyKwh ?? 0;
        strict_1.default.ok(exportWith + 1e-6 < exportWithout, `climate consumes exportable PV: export ${exportWith} < ${exportWithout}`);
    });
    (0, node_test_1.it)("governance writes: global dryrun blocks; live+IH live allows; bat/wb dryrun stay write-blocked", async () => {
        const store = new Map([
            ["global.execution_mode", { val: "dryrun", ack: true }],
            ["addons.immersion_heater.mode", { val: "live", ack: true }],
            ["addons.battery.mode", { val: "dryrun", ack: true }],
            ["addons.wallbox.mode", { val: "dryrun", ack: true }],
        ]);
        const get = async (id) => store.get(id) ?? null;
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "immersion_heater"), false);
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "battery"), false);
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), false);
        store.set("global.execution_mode", { val: "live", ack: true });
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "immersion_heater"), true);
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "battery"), false);
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), false);
    });
});
