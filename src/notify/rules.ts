/**
 * Push-Nachrichten: reine Regeln (keine I/O). Entscheidet, welche Meldungen jetzt fällig sind.
 * Versand und State-Zugriff liegen in index.ts.
 */

export type NotifyConfig = {
	enabled: boolean;
	instance: string;
	timezone: string;
	quietEnabled: boolean;
	quietFrom: string;
	quietTo: string;
	dailyEnabled: boolean;
	dailyTime: string;
	batteryLowEnabled: boolean;
	batteryLowPct: number;
	carEnabled: boolean;
	alertsEnabled: boolean;
};

export type NotifySnapshot = {
	pvTodayKwh: number | null;
	pvTomorrowKwh: number | null;
	batterySocPct: number | null;
	/** Mindest-SOC der Batterie (Entladegrenze); darunter kommt der Haus-Strom aus dem Netz. */
	batteryMinSocPct?: number | null;
	priceNowCt: number | null;
	batteryPlanDe: string;
	carConnected: boolean | null;
	carCharging: boolean | null;
	carSocPct: number | null;
	carLimitPct: number | null;
	wallboxFaultActive: boolean;
	wallboxFaultReasonDe: string;
	health: string;
};

export type NotifyMemory = {
	lastDailyDateKey: string;
	batteryLowArmed: boolean;
	prevCarCharging: boolean | null;
	lastAlertAtMs: Record<string, number>;
};

export type NotifyMessage = {
	kind: "daily" | "battery_low" | "car_started" | "car_finished" | "alert";
	title: string;
	message: string;
	priority: -1 | 0 | 1;
	/** Mindestabstand-Schlüssel für Störungen. */
	alertKey?: string;
};

export const ALERT_MIN_SPACING_MS = 6 * 3_600_000;
export const BATTERY_LOW_REARM_MARGIN_PCT = 10;

export function emptyMemory(): NotifyMemory {
	return { lastDailyDateKey: "", batteryLowArmed: true, prevCarCharging: null, lastAlertAtMs: {} };
}

export function parseHm(value: string, fallbackMin: number): number {
	const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value ?? "");
	if (!m) return fallbackMin;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return fallbackMin;
	return h * 60 + min;
}

export function localClock(nowMs: number, timezone: string): { dateKey: string; minutes: number } {
	let tz = timezone || "Europe/Berlin";
	try {
		new Intl.DateTimeFormat("de-DE", { timeZone: tz });
	} catch {
		tz = "Europe/Berlin";
	}
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date(nowMs));
	const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
	return {
		dateKey: `${get("year")}-${get("month")}-${get("day")}`,
		minutes: Number(get("hour")) * 60 + Number(get("minute")),
	};
}

export function inQuietHours(minutes: number, fromMin: number, toMin: number): boolean {
	if (fromMin === toMin) return false;
	if (fromMin < toMin) return minutes >= fromMin && minutes < toMin;
	return minutes >= fromMin || minutes < toMin;
}

const de = (n: number, digits = 1): string => n.toFixed(digits).replace(".", ",");

export function buildDailyMessage(s: NotifySnapshot): NotifyMessage {
	const lines: string[] = [];
	const pv: string[] = [];
	if (s.pvTodayKwh !== null) pv.push(`heute ${de(s.pvTodayKwh)} kWh`);
	if (s.pvTomorrowKwh !== null) pv.push(`morgen ${de(s.pvTomorrowKwh)} kWh`);
	lines.push(pv.length ? `Sonne: ${pv.join(", ")} erwartet.` : "Sonne: noch keine Prognose.");
	if (s.batterySocPct !== null) lines.push(`Batterie: ${Math.round(s.batterySocPct)} %.`);
	if (s.priceNowCt !== null) lines.push(`Strompreis jetzt: ${de(s.priceNowCt)} ct/kWh.`);
	if (s.carConnected) {
		const soc = s.carSocPct !== null ? `${Math.round(s.carSocPct)} %` : "Stand unbekannt";
		const lim = s.carLimitPct !== null ? `, Ziel ${Math.round(s.carLimitPct)} %` : "";
		lines.push(`Auto: angesteckt, ${soc}${lim}.`);
	}
	return { kind: "daily", title: "EMS · Tagesausblick", message: lines.join("\n"), priority: 0 };
}

export type EvaluateResult = { messages: NotifyMessage[]; memory: NotifyMemory };

export function evaluateNotifications(
	snap: NotifySnapshot,
	cfg: NotifyConfig,
	memoryIn: NotifyMemory,
	nowMs: number,
): EvaluateResult {
	const memory: NotifyMemory = { ...memoryIn, lastAlertAtMs: { ...memoryIn.lastAlertAtMs } };
	const messages: NotifyMessage[] = [];
	if (!cfg.enabled) {
		memory.prevCarCharging = snap.carCharging;
		return { messages, memory };
	}
	const clock = localClock(nowMs, cfg.timezone);
	const quiet = cfg.quietEnabled && inQuietHours(clock.minutes, parseHm(cfg.quietFrom, 22 * 60), parseHm(cfg.quietTo, 7 * 60));

	// Tagesausblick: genau einmal pro Tag, nach der gewählten Uhrzeit. Die Uhrzeit ist eine bewusste Wahl und gilt auch in Ruhezeiten.
	if (cfg.dailyEnabled && memory.lastDailyDateKey !== clock.dateKey && clock.minutes >= parseHm(cfg.dailyTime, 7 * 60 + 30)) {
		messages.push(buildDailyMessage(snap));
		memory.lastDailyDateKey = clock.dateKey;
	}

	// Batterie niedrig: einmal melden, erst wieder scharf, wenn die Batterie sich erholt hat.
	if (cfg.batteryLowEnabled && snap.batterySocPct !== null) {
		const limit = cfg.batteryLowPct;
		if (snap.batterySocPct >= limit + BATTERY_LOW_REARM_MARGIN_PCT) {
			memory.batteryLowArmed = true;
		} else if (snap.batterySocPct <= limit && memory.batteryLowArmed && !quiet) {
			messages.push({
				kind: "battery_low",
				title: "EMS · Batterie fast leer",
				message: snap.batteryMinSocPct != null && snap.batterySocPct > snap.batteryMinSocPct + 1
					? `Die Batterie ist bei ${Math.round(snap.batterySocPct)} % (Warnschwelle ${Math.round(limit)} %). Sie entlädt noch bis ${Math.round(snap.batteryMinSocPct)} %, danach kommt der Haus-Strom aus dem Netz.`
					: `Die Batterie ist bei ${Math.round(snap.batterySocPct)} % (Grenze ${Math.round(limit)} %). Der Haus-Strom kommt jetzt aus dem Netz.`,
				priority: 0,
			});
			memory.batteryLowArmed = false;
		}
	}

	// Auto: nur echte Wechsel melden, nicht den Zustand beim Start.
	if (cfg.carEnabled && snap.carCharging !== null) {
		const prev = memory.prevCarCharging;
		if (prev !== null && !quiet) {
			const soc = snap.carSocPct !== null ? ` Stand: ${Math.round(snap.carSocPct)} %.` : "";
			if (!prev && snap.carCharging) {
				messages.push({ kind: "car_started", title: "EMS · Auto lädt", message: `Die Ladung hat begonnen.${soc}`, priority: -1 });
			} else if (prev && !snap.carCharging) {
				const lim = snap.carLimitPct !== null ? ` Ziel: ${Math.round(snap.carLimitPct)} %.` : "";
				messages.push({ kind: "car_finished", title: "EMS · Autoladung beendet", message: `Die Ladung ist beendet.${soc}${lim}`, priority: -1 });
			}
		}
		if (!quiet || prev === null) memory.prevCarCharging = snap.carCharging;
	}

	// Störungen: dürfen auch in Ruhezeiten kommen, aber nicht öfter als alle 6 Stunden pro Ursache.
	if (cfg.alertsEnabled) {
		const alerts: { key: string; text: string }[] = [];
		if (snap.wallboxFaultActive) {
			alerts.push({ key: "wallbox_fault", text: `Wallbox-Störung: ${snap.wallboxFaultReasonDe || "Ursache unbekannt."}` });
		}
		const h = (snap.health || "").toLowerCase();
		if (h && !["ok", "healthy", "initializing", "starting", ""].includes(h)) {
			alerts.push({ key: "health", text: `Der Adapter meldet den Zustand „${snap.health}".` });
		}
		for (const a of alerts) {
			const last = memory.lastAlertAtMs[a.key] ?? 0;
			if (nowMs - last >= ALERT_MIN_SPACING_MS) {
				messages.push({ kind: "alert", title: "EMS · Störung", message: a.text, priority: 1, alertKey: a.key });
				memory.lastAlertAtMs[a.key] = nowMs;
			}
		}
	}
	return { messages, memory };
}
