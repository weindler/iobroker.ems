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
});
