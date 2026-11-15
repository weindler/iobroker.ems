"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTIFY_LAST_MESSAGE = exports.NOTIFY_STATE_JSON = void 0;
exports.notifyConfigFromAdapter = notifyConfigFromAdapter;
exports.readNotifySnapshot = readNotifySnapshot;
exports.sendPush = sendPush;
exports.tickNotify = tickNotify;
exports.sendNotifyTest = sendNotifyTest;
const rules_1 = require("./rules");
exports.NOTIFY_STATE_JSON = "notify.state_json";
exports.NOTIFY_LAST_MESSAGE = "notify.last_message_de";
function bool(v, def) {
    if (typeof v === "boolean")
        return v;
    if (v === "true")
        return true;
    if (v === "false")
        return false;
    return def;
}
function str(v, def) {
    return typeof v === "string" && v.trim() !== "" ? v.trim() : def;
}
function num(v, def, min, max) {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function notifyConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    return {
        enabled: bool(c.notify_enabled, false),
        instance: str(c.notify_instance, "pushover.0"),
        timezone: str(c.intent_timezone, "Europe/Berlin"),
        quietEnabled: bool(c.notify_quiet_enabled, true),
        quietFrom: str(c.notify_quiet_from, "22:00"),
        quietTo: str(c.notify_quiet_to, "07:00"),
        dailyEnabled: bool(c.notify_daily_enabled, true),
        dailyTime: str(c.notify_daily_time, "07:30"),
        batteryLowEnabled: bool(c.notify_battery_low_enabled, true),
        batteryLowPct: num(c.notify_battery_low_pct, 20, 5, 60),
        carEnabled: bool(c.notify_car_enabled, true),
        alertsEnabled: bool(c.notify_alerts_enabled, true),
    };
}
async function readVal(host, id) {
    try {
        return (await host.getStateAsync(id))?.val;
    }
    catch {
        return undefined;
    }
}
const asNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const asBool = (v) => (typeof v === "boolean" ? v : v === 1 ? true : v === 0 ? false : null);
async function readNotifySnapshot(host) {
    const [pvToday, pvTomorrow, soc, price, plan, conn, chg, carSoc, lim, fault, faultReason, health] = await Promise.all([
        readVal(host, "learning.pv_bias.expected_today_kwh"),
        readVal(host, "learning.pv_bias.corrected_tomorrow_kwh"),
        readVal(host, "live.battery.soc_pct"),
        readVal(host, "live.price.now_ct_per_kwh"),
        readVal(host, "operator.plan.battery_strategy_de"),
        readVal(host, "addons.wallbox.status.evcc.connected"),
        readVal(host, "addons.wallbox.status.evcc.charging"),
        readVal(host, "addons.wallbox.status.evcc.vehicle_soc_pct"),
        readVal(host, "addons.wallbox.status.evcc.effective_limit_soc_pct"),
        readVal(host, "addons.wallbox.runtime.fault_active"),
        readVal(host, "addons.wallbox.runtime.reason_de"),
        readVal(host, "system.health"),
    ]);
    return {
        pvTodayKwh: asNum(pvToday),
        pvTomorrowKwh: asNum(pvTomorrow),
        batterySocPct: asNum(soc),
        priceNowCt: asNum(price),
        batteryPlanDe: typeof plan === "string" ? plan : "",
        carConnected: asBool(conn),
        carCharging: asBool(chg),
        carSocPct: asNum(carSoc),
        carLimitPct: asNum(lim),
        wallboxFaultActive: asBool(fault) === true,
        wallboxFaultReasonDe: typeof faultReason === "string" ? faultReason : "",
        health: typeof health === "string" ? health : "",
    };
}
async function loadMemory(host) {
    const raw = await readVal(host, exports.NOTIFY_STATE_JSON);
    if (typeof raw !== "string" || raw === "" || raw === "{}")
        return (0, rules_1.emptyMemory)();
    try {
        const p = JSON.parse(raw);
        return {
            lastDailyDateKey: typeof p.lastDailyDateKey === "string" ? p.lastDailyDateKey : "",
            batteryLowArmed: p.batteryLowArmed !== false,
            prevCarCharging: typeof p.prevCarCharging === "boolean" ? p.prevCarCharging : null,
            lastAlertAtMs: p.lastAlertAtMs && typeof p.lastAlertAtMs === "object" ? p.lastAlertAtMs : {},
        };
    }
    catch {
        return (0, rules_1.emptyMemory)();
    }
}
async function sendPush(host, instance, m) {
    if (!host.sendToAsync)
        throw new Error("sendTo nicht verfügbar");
    await host.sendToAsync(instance, { message: m.message, title: m.title, priority: m.priority });
}
let lastSendErrorLogMs = 0;
/** Wird vom EMS-Tick (alle 60 s) aufgerufen. Sendet höchstens die fälligen Meldungen. */
async function tickNotify(host, nowMs = Date.now()) {
    const cfg = notifyConfigFromAdapter(host.config);
    if (!cfg.enabled)
        return;
    const [snap, mem] = await Promise.all([readNotifySnapshot(host), loadMemory(host)]);
    const result = (0, rules_1.evaluateNotifications)(snap, cfg, mem, nowMs);
    for (const m of result.messages) {
        try {
            await sendPush(host, cfg.instance, m);
            const hm = new Date(nowMs).toLocaleTimeString("de-DE", { timeZone: cfg.timezone, hour: "2-digit", minute: "2-digit" });
            await host.setStateAsync(exports.NOTIFY_LAST_MESSAGE, { val: `${hm} · ${m.title}: ${m.message.split("\n")[0]}`, ack: true });
        }
        catch (e) {
            if (nowMs - lastSendErrorLogMs > 3_600_000) {
                lastSendErrorLogMs = nowMs;
                host.log.warn(`Push-Nachricht an ${cfg.instance} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }
    await host.setStateAsync(exports.NOTIFY_STATE_JSON, { val: JSON.stringify(result.memory), ack: true });
}
/** Testknopf im Admin. */
async function sendNotifyTest(host) {
    const cfg = notifyConfigFromAdapter(host.config);
    try {
        await sendPush(host, cfg.instance, {
            title: "EMS · Test",
            message: "Die Verbindung zu den Push-Nachrichten funktioniert.",
            priority: 0,
        });
        return { ok: true, text: `Testnachricht an ${cfg.instance} gesendet.` };
    }
    catch (e) {
        return { ok: false, text: `Senden an ${cfg.instance} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}` };
    }
}
