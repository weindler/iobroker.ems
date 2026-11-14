import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { compareSnapshots, type EfSnapshot } from "./compare";
import { fullDaysAhead, localDay, parseEnergyforecastResponse, redactToken, slotAt } from "./parse";
import { addFetchToSnapshots, emptySnapshotFile } from "./persist";
import {
	energyforecastConfigFromAdapter,
	fetchDue,
	resetEnergyforecastRunState,
	runEnergyforecast,
	type EnergyforecastHost,
} from "./run";
import { emptyCache } from "./persist";

const TOKEN = "SECRET-TOKEN-123";

function dayRows(date: string, origin: "market" | "forecast", base: number, shape = 1): unknown[] {
	const rows: unknown[] = [];
	const start = new Date(`${date}T00:00:00`).getTime();
	for (let i = 0; i < 96; i++) {
		const s = start + i * 900_000;
		const total = base + shape * Math.sin((i / 96) * 2 * Math.PI) * 5;
		rows.push({
			start: new Date(s).toISOString(),
			end: new Date(s + 900_000).toISOString(),
			price_ct_kwh: total / 1.19 - 12,
			total_ct_kwh: total,
			price_origin: origin,
		});
	}
	return rows;
}

describe("energyforecast parse", () => {
	it("liest Slots, Tarif und Herkunft, verwirft Ungültiges", () => {
		const p = parseEnergyforecastResponse({
			plan: "free",
			generated_at: "2026-11-14T08:00:00Z",
			data: [
				{ start: "2026-11-14T00:00:00+01:00", end: "2026-11-14T00:15:00+01:00", price_ct_kwh: 20.2, total_ct_kwh: 39.3176, price_origin: "market" },
				{ start: "2026-11-14T00:15:00+01:00", end: "2026-11-14T00:30:00+01:00", total_ct_kwh: "x" },
				{ start: "kaputt", total_ct_kwh: 30 },
				{ start: "2026-11-14T00:30:00+01:00", total_ct_kwh: 9999 },
				{ start: "2026-11-15T00:00:00+01:00", end: "2026-11-15T00:15:00+01:00", total_ct_kwh: 36.5, price_origin: "forecast" },
			],
		});
		assert.equal(p.slots.length, 2);
		assert.equal(p.plan, "free");
		assert.equal(p.slots[0].origin, "market");
		assert.equal(p.slots[1].origin, "forecast");
		assert.equal(p.generatedAtIso, "2026-11-14T08:00:00Z");
	});

	it("kaputte Antwort → keine Slots, kein Fehler", () => {
		assert.equal(parseEnergyforecastResponse(null).slots.length, 0);
		assert.equal(parseEnergyforecastResponse("nicht json").slots.length, 0);
		assert.equal(parseEnergyforecastResponse({ data: "x" }).slots.length, 0);
	});

	it("zählt volle Tage nach heute und findet den laufenden Slot", () => {
		const rows = [...dayRows("2026-11-14", "market", 38), ...dayRows("2026-11-15", "forecast", 38), ...dayRows("2026-11-16", "forecast", 38)];
		const p = parseEnergyforecastResponse({ data: rows });
		const now = new Date("2026-11-14T09:20:00").getTime();
		assert.equal(fullDaysAhead(p.slots, now), 2);
		assert.equal(slotAt(p.slots, now)?.startMs, new Date("2026-11-14T09:15:00").getTime());
	});

	it("entfernt den Token aus Texten", () => {
		assert.equal(redactToken(`fail https://x/api?token=${TOKEN}&a=1`, TOKEN).includes(TOKEN), false);
		assert.equal(redactToken("fetch failed token=abc", "").includes("abc"), false);
	});
});

describe("energyforecast Vergleich", () => {
	it("hält Prognose fest und vergleicht später gegen echten Preis (Vorlauf 1)", () => {
		const day1 = "2026-11-15";
		// Abruf am 14.11. 12:00: 15.11. ist Prognose
		const f1 = parseEnergyforecastResponse({ data: [...dayRows("2026-11-14", "market", 38), ...dayRows(day1, "forecast", 38, 1)] });
		const at1 = new Date("2026-11-14T12:00:00").getTime();
		let file = addFetchToSnapshots(emptySnapshotFile(), f1, at1);
		assert.equal(file.snapshots.length, 1);
		// gleicher Stand erneut → kein zweiter Snapshot
		file = addFetchToSnapshots(file, f1, at1 + 6 * 3_600_000);
		assert.equal(file.snapshots.length, 1);
		// Abruf am 15.11. 06:00: 15.11. ist jetzt Markt mit stärkerer Spreizung und +2 ct
		const f2 = parseEnergyforecastResponse({ data: dayRows(day1, "market", 40, 2) });
		file = addFetchToSnapshots(file, f2, new Date("2026-11-15T06:00:00").getTime());
		const res = compareSnapshots(file.snapshots, file.actual);
		const lead1 = res.perLead.find((l) => l.leadDays === 1);
		if (!lead1) throw new Error("Vorlauf 1 fehlt");
		assert.equal(lead1.days, 1);
		assert.ok(lead1.biasCt < -1.5 && lead1.biasCt > -2.5, `Bias ${lead1.biasCt}`); // Prognose ~2 ct zu niedrig
		assert.ok(lead1.actualSpreadCt > lead1.forecastSpreadCt, "Spreizung unterschätzt");
		assert.ok(lead1.cheapHitPct >= 80, `Treffer ${lead1.cheapHitPct}`);
		assert.ok(res.biasByHour.length > 0);
	});

	it("ohne echte Preise kein Ergebnis", () => {
		const f = parseEnergyforecastResponse({ data: dayRows("2026-11-15", "forecast", 38) });
		const file = addFetchToSnapshots(emptySnapshotFile(), f, new Date("2026-11-14T12:00:00").getTime());
		assert.deepEqual(compareSnapshots(file.snapshots, file.actual).perLead, []);
	});

	it("unvollständige Tage zählen nicht", () => {
		const snap: EfSnapshot = { atMs: new Date("2026-11-14T12:00:00").getTime(), slots: [[new Date("2026-11-15T00:00:00").getTime(), 40]] };
		const actual = { [String(new Date("2026-11-15T00:00:00").getTime())]: 41 };
		assert.equal(compareSnapshots([snap], actual).perDay.length, 0);
	});
});

describe("energyforecast Lauf", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "ef-"));
		resetEnergyforecastRunState();
	});
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	function makeHost(config: Record<string, unknown>) {
		const states = new Map<string, ioBroker.StateValue>();
		const logs: string[] = [];
		const host = {
			config,
			getAbsolutePath: () => dir,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				states.set(id, (st as { val: ioBroker.StateValue }).val);
			},
			getStateAsync: async () => null,
			setObjectNotExistsAsync: async () => undefined,
			log: {
				info: (m: string) => logs.push(m),
				debug: (m: string) => logs.push(m),
				warn: (m: string) => logs.push(m),
			},
		} as unknown as EnergyforecastHost;
		return { host, states, logs };
	}

	it("aus oder ohne Token: kein Abruf", async () => {
		let calls = 0;
		const fetchFn = async () => {
			calls++;
			return new Response("{}");
		};
		const off = makeHost({ energyforecast_enabled: false, energyforecast_token: TOKEN });
		await runEnergyforecast(off.host, Date.now(), fetchFn);
		assert.equal(off.states.get("learning.energyforecast.status"), "disabled");
		const noTok = makeHost({ energyforecast_enabled: true, energyforecast_token: "" });
		await runEnergyforecast(noTok.host, Date.now(), fetchFn);
		assert.equal(noTok.states.get("learning.energyforecast.status"), "no_token");
		assert.equal(calls, 0);
	});

	it("Abruf ok: States, Tarif, Tage, Preis jetzt; zweiter Lauf holt nicht erneut", async () => {
		const now = new Date("2026-11-14T09:20:00").getTime();
		let calls = 0;
		let url = "";
		const body = {
			plan: "free",
			data: [...dayRows("2026-11-14", "market", 38), ...dayRows("2026-11-15", "forecast", 38), ...dayRows("2026-11-16", "forecast", 38)],
		};
		const fetchFn = async (u: string | URL | Request) => {
			calls++;
			url = String(u);
			return new Response(JSON.stringify(body), { status: 200 });
		};
		const { host, states, logs } = makeHost({ energyforecast_enabled: true, energyforecast_token: TOKEN });
		await runEnergyforecast(host, now, fetchFn);
		assert.equal(states.get("learning.energyforecast.status"), "ok");
		assert.equal(states.get("learning.energyforecast.plan"), "free");
		assert.equal(states.get("learning.energyforecast.days_ahead"), 2);
		assert.equal(typeof states.get("learning.energyforecast.price_now"), "number");
		assert.ok(url.includes(encodeURIComponent(TOKEN)));
		await runEnergyforecast(host, now + 3_600_000, fetchFn);
		assert.equal(calls, 1, "innerhalb von 6 h kein neuer Abruf");
		await runEnergyforecast(host, now + 6 * 3_600_000, fetchFn);
		assert.equal(calls, 2);
		const all = JSON.stringify([...states.entries()]) + logs.join("|");
		assert.equal(all.includes(TOKEN), false, "Token nie in States oder Logs");
	});

	it("Fehler 401: Status error, Token nicht im Text, Wiederholung erst nach 55 min", async () => {
		const now = new Date("2026-11-14T09:20:00").getTime();
		let calls = 0;
		const fetchFn = async () => {
			calls++;
			return new Response("no", { status: 401 });
		};
		const { host, states, logs } = makeHost({ energyforecast_enabled: true, energyforecast_token: TOKEN });
		await runEnergyforecast(host, now, fetchFn);
		assert.equal(states.get("learning.energyforecast.status"), "error");
		assert.match(String(states.get("learning.energyforecast.status_de")), /Token ungültig/);
		await runEnergyforecast(host, now + 10 * 60_000, fetchFn);
		assert.equal(calls, 1);
		await runEnergyforecast(host, now + 56 * 60_000, fetchFn);
		assert.equal(calls, 2);
		assert.equal((JSON.stringify([...states.entries()]) + logs.join("|")).includes(TOKEN), false);
	});

	it("Netzwerkfehler mit Token im Text wird bereinigt", async () => {
		const fetchFn = async () => {
			throw new Error(`getaddrinfo failed for https://x/api?token=${TOKEN}`);
		};
		const { host, states, logs } = makeHost({ energyforecast_enabled: true, energyforecast_token: TOKEN });
		await runEnergyforecast(host, Date.now(), fetchFn);
		assert.equal((JSON.stringify([...states.entries()]) + logs.join("|")).includes(TOKEN), false);
		assert.equal(states.get("learning.energyforecast.status"), "error");
	});

	it("Config und Fälligkeit", () => {
		assert.deepEqual(energyforecastConfigFromAdapter({}), { enabled: false, token: "" });
		assert.equal(energyforecastConfigFromAdapter({ energyforecast_enabled: true, energyforecast_token: "  t " }).token, "t");
		const c = emptyCache();
		assert.equal(fetchDue(c, 1000), true);
		assert.equal(fetchDue({ ...c, fetchedAtIso: "x", lastAttemptMs: 1000 }, 1000 + 3_600_000), false);
		assert.equal(fetchDue({ ...c, fetchedAtIso: "x", lastAttemptMs: 1000 }, 1000 + 6 * 3_600_000), true);
		assert.equal(fetchDue({ ...c, lastAttemptMs: 1000, lastError: "e", lastErrorStatus: 429 }, 1000 + 2 * 3_600_000), false);
		assert.equal(localDay(new Date("2026-11-14T09:20:00").getTime()), "2026-11-14");
	});
});

import { frozenForecastFromSnapshots } from "./run";
import { buildVisPriceTimeline } from "../../operator/vis/price_timeline";

describe("festgehaltene Prognose im Preisdiagramm", () => {
	it("nimmt je Viertelstunde den neuesten Snapshot", () => {
		const m = frozenForecastFromSnapshots([
			{ atMs: 2, slots: [[100, 30]] },
			{ atMs: 1, slots: [[100, 20], [200, 25]] },
		]);
		assert.equal(m.get(100), 30);
		assert.equal(m.get(200), 25);
	});

	it("hängt forecastCt nur an echte Preise, nicht an Prognose-Slots", () => {
		const now = new Date("2026-11-14T12:00:00.000Z");
		const t0 = Date.parse("2026-11-14T13:00:00.000Z");
		const t1 = t0 + 15 * 60_000;
		const board = buildVisPriceTimeline({
			now,
			currentPriceCt: 30,
			gbMinPriceCt: null,
			gbPriceAllowed: null,
			gridSlots: [
				{ startIso: new Date(t0).toISOString(), priceCtPerKwh: 33 },
				{ startIso: new Date(t1).toISOString(), priceCtPerKwh: 34 },
			],
			forecastStartsMs: new Set([t1]),
			frozenForecastCt: new Map([[t0, 30.123], [t1, 31]]),
			batteryAlloc: [],
			wallboxAlloc: [],
			immersionAlloc: [],
			climateAlloc: [],
		});
		const a = board.slots.find((s) => Date.parse(s.startIso) === t0);
		const b = board.slots.find((s) => Date.parse(s.startIso) === t1);
		assert.equal(a?.forecastCt, 30.12);
		assert.equal(b?.forecastCt, undefined);
	});
});
