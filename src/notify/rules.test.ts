import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildDailyMessage,
	emptyMemory,
	evaluateNotifications,
	inQuietHours,
	parseHm,
	type NotifyConfig,
	type NotifySnapshot,
} from "./rules";

const cfg: NotifyConfig = {
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
const snap: NotifySnapshot = {
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
const at = (hhmmUtc: string): number => Date.parse(`2026-11-15T${hhmmUtc}:00Z`);

describe("notify rules", () => {
	it("parseHm und Ruhezeit über Mitternacht", () => {
		assert.equal(parseHm("07:30", 0), 450);
		assert.equal(parseHm("kaputt", 99), 99);
		assert.equal(inQuietHours(23 * 60, 22 * 60, 7 * 60), true);
		assert.equal(inQuietHours(3 * 60, 22 * 60, 7 * 60), true);
		assert.equal(inQuietHours(12 * 60, 22 * 60, 7 * 60), false);
	});
	it("Tagesausblick genau einmal pro Tag nach der Uhrzeit", () => {
		const early = evaluateNotifications(snap, cfg, emptyMemory(), at("06:00"));
		assert.equal(early.messages.length, 0);
		const first = evaluateNotifications(snap, cfg, emptyMemory(), at("07:00"));
		assert.equal(first.messages[0].kind, "daily");
		assert.match(first.messages[0].message, /heute 7,4 kWh, morgen 5,7 kWh/);
		const again = evaluateNotifications(snap, cfg, first.memory, at("08:00"));
		assert.equal(again.messages.length, 0);
	});
	it("nichts senden, wenn ausgeschaltet", () => {
		const r = evaluateNotifications(snap, { ...cfg, enabled: false }, emptyMemory(), at("07:00"));
		assert.equal(r.messages.length, 0);
	});
	it("Batterie niedrig: Text nennt die echte Entladegrenze, wenn sie unter der Warnschwelle liegt", () => {
		const m = evaluateNotifications({ ...snap, batterySocPct: 20, batteryMinSocPct: 10 }, cfg, emptyMemory(), at("12:00"))
			.messages.find((x) => x.kind === "battery_low");
		assert.ok(m && m.message.includes("entlädt noch bis 10 %") && !m.message.includes("jetzt aus dem Netz"));
		const m2 = evaluateNotifications({ ...snap, batterySocPct: 10, batteryMinSocPct: 10 }, cfg, emptyMemory(), at("12:00"))
			.messages.find((x) => x.kind === "battery_low");
		assert.ok(m2 && m2.message.includes("jetzt aus dem Netz"));
	});
	it("Batterie niedrig: einmal melden, nicht in Ruhezeit, wieder scharf nach Erholung", () => {
		const low = { ...snap, batterySocPct: 18 };
		const quiet = evaluateNotifications(low, cfg, emptyMemory(), at("22:30"));
		assert.equal(quiet.messages.filter((m) => m.kind === "battery_low").length, 0);
		const r1 = evaluateNotifications(low, cfg, emptyMemory(), at("12:00"));
		assert.equal(r1.messages.filter((m) => m.kind === "battery_low").length, 1);
		const r2 = evaluateNotifications(low, cfg, r1.memory, at("12:10"));
		assert.equal(r2.messages.filter((m) => m.kind === "battery_low").length, 0);
		const r3 = evaluateNotifications({ ...snap, batterySocPct: 40 }, cfg, r2.memory, at("14:00"));
		assert.equal(r3.memory.batteryLowArmed, true);
	});
	it("Auto: Start-Zustand wird nicht gemeldet, nur Wechsel", () => {
		const r0 = evaluateNotifications({ ...snap, carCharging: true }, cfg, emptyMemory(), at("12:00"));
		assert.equal(r0.messages.filter((m) => m.kind.startsWith("car")).length, 0);
		const r1 = evaluateNotifications({ ...snap, carCharging: false }, cfg, r0.memory, at("12:05"));
		assert.equal(r1.messages[0].kind, "car_finished");
		const r2 = evaluateNotifications({ ...snap, carCharging: true }, cfg, r1.memory, at("12:10"));
		assert.equal(r2.messages[0].kind, "car_started");
	});
	it("Störung kommt auch nachts, aber höchstens alle 6 Stunden", () => {
		const bad = { ...snap, wallboxFaultActive: true, wallboxFaultReasonDe: "Ladepunkt nicht erreichbar" };
		const r1 = evaluateNotifications(bad, cfg, emptyMemory(), at("23:30"));
		assert.equal(r1.messages.filter((m) => m.kind === "alert").length, 1);
		assert.equal(r1.messages.find((m) => m.kind === "alert")?.priority, 1);
		const r2 = evaluateNotifications(bad, cfg, r1.memory, at("23:40"));
		assert.equal(r2.messages.filter((m) => m.kind === "alert").length, 0);
	});
	it("Tagesausblick ohne Daten bleibt lesbar", () => {
		const m = buildDailyMessage({ ...snap, pvTodayKwh: null, pvTomorrowKwh: null, batterySocPct: null, priceNowCt: null, carConnected: false });
		assert.match(m.message, /noch keine Prognose/);
	});
});

describe("Tagesausblick Inhalt", () => {
	it("enthält keine technischen Planungstexte", () => {
		const m = buildDailyMessage({ ...snap, batteryPlanDe: "Unified plant Batterie-Ladung. Noch nicht berechenbar, es fehlt: Wirkungsgrad" });
		assert.equal(/Unified|berechenbar|Wirkungsgrad/.test(m.message), false);
		assert.match(m.message, /Batterie: 39 %/);
	});
});
