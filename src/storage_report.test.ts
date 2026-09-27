import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildStorageReport, growthPerDay, storageReportHtml, storageReportText } from "./storage_report";

describe("Speicherbericht", () => {
	it("erfindet ohne mindestens drei Messtage keine Hochrechnung", () => {
		assert.equal(growthPerDay([{ ts: 0, bytes: 100 }, { ts: 86_400_000, bytes: 200 }]), null);
	});
	it("berechnet gemessenes tägliches Wachstum", () => {
		assert.equal(growthPerDay([{ ts: 0, bytes: 100 }, { ts: 86_400_000, bytes: 200 }, { ts: 172_800_000, bytes: 300 }]), 100);
	});
	it("liefert sichtbar Datenarten, Zeitraum und Aufbewahrung statt nur OK", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ems-storage-"));
		try {
			await fs.mkdir(path.join(dir, "learning"), { recursive: true });
			await fs.writeFile(path.join(dir, "learning", "sample.json"), "{}");
			const report = await buildStorageReport(dir, new Date("2026-09-13T12:00:00Z"));
			assert.equal(report.categories.learning?.files, 1);
			assert.match(storageReportText(report), /EMS aktuell/);
			const html = storageReportHtml(report);
			assert.match(html, /Belegung nach Datenart/);
			assert.match(html, /Noch nicht genügend Daten/);
			assert.match(html, /Aufbewahrung/);
			assert.doesNotMatch(html, /^OK$/i);
		} finally { await fs.rm(dir, { recursive: true, force: true }); }
	});
	it("zählt Laufzeitdaten und dauerhafte Tages-Telemetrie ohne doppeltes Wachstum", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "ems-storage-roots-"));
		try {
			const runtime = path.join(root, "ems-runtime.0");
			const durable = path.join(root, "ems.0");
			await fs.mkdir(path.join(runtime, "exports", "backup"), { recursive: true });
			await fs.mkdir(path.join(durable, "learning", "day_telemetry"), { recursive: true });
			await fs.writeFile(path.join(runtime, "exports", "backup", "latest.emsbackup"), Buffer.alloc(1024));
			await fs.writeFile(path.join(durable, "learning", "day_telemetry", "day_telemetry_v1.json"), Buffer.alloc(3 * 1024 * 1024));
			await fs.writeFile(path.join(runtime, "storage_report_history_v1.json"), JSON.stringify([
				{ ts: Date.parse("2026-09-24T12:00:00Z"), bytes: 100 },
				{ ts: Date.parse("2026-09-25T12:00:00Z"), bytes: 200 },
				{ ts: Date.parse("2026-09-26T12:00:00Z"), bytes: 300 },
			]));
			const report = await buildStorageReport(runtime, new Date("2026-09-27T12:00:00Z"), durable);
			assert.equal(report.bytes, 3 * 1024 * 1024 + 1024);
			assert.equal(report.categories["learning/day_telemetry"]?.bytes, 3 * 1024 * 1024);
			assert.equal(report.categories["learning/day_telemetry"]?.retentionDe, "90 Tage");
			assert.equal(report.categories.exports?.files, 1);
			assert.equal(report.growthBytesPerDay, null);
			assert.deepEqual(report.errors, []);
		} finally { await fs.rm(root, { recursive: true, force: true }); }
	});
});
