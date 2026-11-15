import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMemoryDiagnostics } from "./memory_diag";

const MB = 1024 * 1024;
describe("memory_diag", () => {
	it("meldet unauffällig bei kleinem Speicher", () => {
		const d = buildMemoryDiagnostics({ rss: 150 * MB, heapUsed: 60 * MB, heapTotal: 80 * MB, external: 5 * MB, arrayBuffers: 1 * MB }, 0, 600, 0);
		assert.equal(d.rssMb, 150);
		assert.equal(d.outsideHeapMb, 70);
		assert.match(d.hintDe, /unauffällig/);
	});
	it("erkennt Puffer als Ursache und merkt den Spitzenwert", () => {
		const d = buildMemoryDiagnostics({ rss: 600 * MB, heapUsed: 120 * MB, heapTotal: 170 * MB, external: 300 * MB, arrayBuffers: 200 * MB }, 0, 3600, 700);
		assert.match(d.hintDe, /Puffern/);
		assert.equal(d.rssPeakMb, 700);
	});
	it("erkennt Fragmentierung, wenn weder Heap noch Puffer groß sind", () => {
		const d = buildMemoryDiagnostics({ rss: 600 * MB, heapUsed: 120 * MB, heapTotal: 170 * MB, external: 10 * MB, arrayBuffers: 2 * MB }, 0, 3600, 0);
		assert.match(d.hintDe, /Fragmentierung/);
	});
});

import { getMemorySeries, recordMemorySample } from "./memory_diag";
describe("memory_diag series", () => {
	it("zeichnet Verlauf auf und begrenzt ihn", () => {
		for (let i = 0; i < 200; i++) recordMemorySample({ rss: 300 * MB, heapUsed: 100 * MB, heapTotal: 120 * MB, external: 0, arrayBuffers: 0 }, i * 60);
		const s = getMemorySeries();
		assert.equal(s.length, 180);
		assert.deepEqual(s[s.length - 1], [199, 300, 100]);
	});
});
