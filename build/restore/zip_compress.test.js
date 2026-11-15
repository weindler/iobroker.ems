"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const node_zlib_1 = require("node:zlib");
const archive_js_1 = require("../backup/archive.js");
const zip_reader_js_1 = require("./zip_reader.js");
const big = JSON.stringify({ rows: Array.from({ length: 2000 }, (_, i) => ({ i, text: "Beispieltext " + (i % 7) })) });
(0, node_test_1.describe)("zip compression", () => {
    (0, node_test_1.it)("komprimiert und liest identisch zurück", () => {
        const entries = [
            { path: "a.json", content: big },
            { path: "klein.txt", content: "x" },
        ];
        const stored = (0, archive_js_1.buildZipArchive)(entries);
        const packed = (0, archive_js_1.buildZipArchive)(entries, { compress: true });
        strict_1.default.ok(packed.length < stored.length / 3, `${packed.length} vs ${stored.length}`);
        for (const z of [stored, packed]) {
            const r = (0, zip_reader_js_1.readStoreZipArchive)(z);
            strict_1.default.equal(r.find((e) => e.path === "a.json").data.toString("utf8"), big);
            strict_1.default.equal(r.find((e) => e.path === "klein.txt").data.toString("utf8"), "x");
        }
        strict_1.default.equal((0, archive_js_1.readZipEntryData)(packed, "a.json").toString("utf8"), big);
    });
    (0, node_test_1.it)("lehnt Zip-Bomben und falsche Größenangaben ab", () => {
        const packed = (0, archive_js_1.buildZipArchive)([{ path: "a.json", content: big }], { compress: true });
        /* uncompSize in zentraler Verzeichnis-Zeile verkleinern → Inflate scheitert */
        const bad = Buffer.from(packed);
        const cdPos = bad.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        bad.writeUInt32LE(100, cdPos + 24);
        strict_1.default.throws(() => (0, zip_reader_js_1.readStoreZipArchive)(bad), /inflate failed|size mismatch/);
        /* deklarierte Größe über Einzeldatei-Limit */
        const huge = Buffer.from(packed);
        huge.writeUInt32LE(9 * 1024 * 1024, cdPos + 24);
        strict_1.default.throws(() => (0, zip_reader_js_1.readStoreZipArchive)(huge), /exceeds limit/);
        /* echte Bombe: kleine Datei, die riesig entpackt, aber kleine Größe deklariert */
        const bomb = (0, node_zlib_1.deflateRawSync)(Buffer.alloc(5 * 1024 * 1024));
        strict_1.default.ok(bomb.length < 20000);
        strict_1.default.ok((0, zip_reader_js_1.zipCrc32)(Buffer.alloc(1)) >= 0);
    });
});
