"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const rules_1 = require("./rules");
const cfg = {
    enabled: true,
    instance: "pushover.0",
    timezone: "Europe/Berlin",
    quietEnabled: true,
    quietFrom: "22:00",
    quietTo: "07:00",
    dailyEnabled: true,
    dailyTime: "07:30",
    batteryLowEnabled: true,
    batteryLowPct: 20,
    carEnabled: true,
    alertsEnabled: true,
};
const snap = {
    pvTodayKwh: 7.4,
    pvTomorrowKwh: 5.7,
    batterySocPct: 39,
    priceNowCt: 31.4,
    batteryPlanDe: "",
    carConnected: true,
    carCharging: false,
    carSocPct: 35,
    carLimitPct: 65,
    wallboxFaultActive: false,
    wallboxFaultReasonDe: "",
    health: "ok",
};
// 15.11.2026 08:00 Berlin = 07:00 UTC
const at = (hhmmUtc) => Date.parse(`2026-11-15T${hhmmUtc}:00Z`);
(0, node_test_1.describe)("notify rules", () => {
    (0, node_test_1.it)("parseHm und Ruhezeit über Mitternacht", () => {
        strict_1.default.equal((0, rules_1.parseHm)("07:30", 0), 450);
        strict_1.default.equal((0, rules_1.parseHm)("kaputt", 99), 99);
        strict_1.default.equal((0, rules_1.inQuietHours)(23 * 60, 22 * 60, 7 * 60), true);
        strict_1.default.equal((0, rules_1.inQuietHours)(3 * 60, 22 * 60, 7 * 60), true);
        strict_1.default.equal((0, rules_1.inQuietHours)(12 * 60, 22 * 60, 7 * 60), false);
    });
    (0, node_test_1.it)("Tagesausblick genau einmal pro Tag nach der Uhrzeit", () => {
        const early = (0, rules_1.evaluateNotifications)(snap, cfg, (0, rules_1.emptyMemory)(), at("06:00"));
        strict_1.default.equal(early.messages.length, 0);
        const first = (0, rules_1.evaluateNotifications)(snap, cfg, (0, rules_1.emptyMemory)(), at("07:00"));
        strict_1.default.equal(first.messages[0].kind, "daily");
        strict_1.default.match(first.messages[0].message, /heute 7,4 kWh, morgen 5,7 kWh/);
        const again = (0, rules_1.evaluateNotifications)(snap, cfg, first.memory, at("08:00"));
        strict_1.default.equal(again.messages.length, 0);
    });
    (0, node_test_1.it)("nichts senden, wenn ausgeschaltet", () => {
        const r = (0, rules_1.evaluateNotifications)(snap, { ...cfg, enabled: false }, (0, rules_1.emptyMemory)(), at("07:00"));
        strict_1.default.equal(r.messages.length, 0);
    });
    (0, node_test_1.it)("Batterie niedrig: einmal melden, nicht in Ruhezeit, wieder scharf nach Erholung", () => {
        const low = { ...snap, batterySocPct: 18 };
        const quiet = (0, rules_1.evaluateNotifications)(low, cfg, (0, rules_1.emptyMemory)(), at("22:30"));
        strict_1.default.equal(quiet.messages.filter((m) => m.kind === "battery_low").length, 0);
        const r1 = (0, rules_1.evaluateNotifications)(low, cfg, (0, rules_1.emptyMemory)(), at("12:00"));
        strict_1.default.equal(r1.messages.filter((m) => m.kind === "battery_low").length, 1);
        const r2 = (0, rules_1.evaluateNotifications)(low, cfg, r1.memory, at("12:10"));
        strict_1.default.equal(r2.messages.filter((m) => m.kind === "battery_low").length, 0);
        const r3 = (0, rules_1.evaluateNotifications)({ ...snap, batterySocPct: 40 }, cfg, r2.memory, at("14:00"));
        strict_1.default.equal(r3.memory.batteryLowArmed, true);
    });
    (0, node_test_1.it)("Auto: Start-Zustand wird nicht gemeldet, nur Wechsel", () => {
        const r0 = (0, rules_1.evaluateNotifications)({ ...snap, carCharging: true }, cfg, (0, rules_1.emptyMemory)(), at("12:00"));
        strict_1.default.equal(r0.messages.filter((m) => m.kind.startsWith("car")).length, 0);
        const r1 = (0, rules_1.evaluateNotifications)({ ...snap, carCharging: false }, cfg, r0.memory, at("12:05"));
        strict_1.default.equal(r1.messages[0].kind, "car_finished");
        const r2 = (0, rules_1.evaluateNotifications)({ ...snap, carCharging: true }, cfg, r1.memory, at("12:10"));
        strict_1.default.equal(r2.messages[0].kind, "car_started");
    });
    (0, node_test_1.it)("Störung kommt auch nachts, aber höchstens alle 6 Stunden", () => {
        const bad = { ...snap, wallboxFaultActive: true, wallboxFaultReasonDe: "Ladepunkt nicht erreichbar" };
        const r1 = (0, rules_1.evaluateNotifications)(bad, cfg, (0, rules_1.emptyMemory)(), at("23:30"));
        strict_1.default.equal(r1.messages.filter((m) => m.kind === "alert").length, 1);
        strict_1.default.equal(r1.messages.find((m) => m.kind === "alert")?.priority, 1);
        const r2 = (0, rules_1.evaluateNotifications)(bad, cfg, r1.memory, at("23:40"));
        strict_1.default.equal(r2.messages.filter((m) => m.kind === "alert").length, 0);
    });
    (0, node_test_1.it)("Tagesausblick ohne Daten bleibt lesbar", () => {
        const m = (0, rules_1.buildDailyMessage)({ ...snap, pvTodayKwh: null, pvTomorrowKwh: null, batterySocPct: null, priceNowCt: null, carConnected: false });
        strict_1.default.match(m.message, /noch keine Prognose/);
    });
});
(0, node_test_1.describe)("Tagesausblick Inhalt", () => {
    (0, node_test_1.it)("enthält keine technischen Planungstexte", () => {
        const m = (0, rules_1.buildDailyMessage)({ ...snap, batteryPlanDe: "Unified plant Batterie-Ladung. Noch nicht berechenbar, es fehlt: Wirkungsgrad" });
        strict_1.default.equal(/Unified|berechenbar|Wirkungsgrad/.test(m.message), false);
        strict_1.default.match(m.message, /Batterie: 39 %/);
    });
});
