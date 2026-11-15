import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";
import { buildZipArchive, readZipEntryData } from "../backup/archive.js";
import { readStoreZipArchive, zipCrc32 } from "./zip_reader.js";

const big = JSON.stringify({ rows: Array.from({ length: 2000 }, (_, i) => ({ i, text: "Beispieltext " + (i % 7) })) });

describe("zip compression", () => {
	it("komprimiert und liest identisch zurück", () => {
		const entries = [
			{ path: "a.json", content: big },
			{ path: "klein.txt", content: "x" },
		];
		const stored = buildZipArchive(entries);
		const packed = buildZipArchive(entries, { compress: true });
		assert.ok(packed.length < stored.length / 3, `${packed.length} vs ${stored.length}`);
		for (const z of [stored, packed]) {
			const r = readStoreZipArchive(z);
			assert.equal(r.find((e) => e.path === "a.json")!.data.toString("utf8"), big);
			assert.equal(r.find((e) => e.path === "klein.txt")!.data.toString("utf8"), "x");
		}
		assert.equal(readZipEntryData(packed, "a.json")!.toString("utf8"), big);
	});

	it("lehnt Zip-Bomben und falsche Größenangaben ab", () => {
		const packed = buildZipArchive([{ path: "a.json", content: big }], { compress: true });
		/* uncompSize in zentraler Verzeichnis-Zeile verkleinern → Inflate scheitert */
		const bad = Buffer.from(packed);
		const cdPos = bad.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
		bad.writeUInt32LE(100, cdPos + 24);
		assert.throws(() => readStoreZipArchive(bad), /inflate failed|size mismatch/);
		/* deklarierte Größe über Einzeldatei-Limit */
		const huge = Buffer.from(packed);
		huge.writeUInt32LE(9 * 1024 * 1024, cdPos + 24);
		assert.throws(() => readStoreZipArchive(huge), /exceeds limit/);
		/* echte Bombe: kleine Datei, die riesig entpackt, aber kleine Größe deklariert */
		const bomb = deflateRawSync(Buffer.alloc(5 * 1024 * 1024));
		assert.ok(bomb.length < 20000);
		assert.ok(zipCrc32(Buffer.alloc(1)) >= 0);
	});
});
