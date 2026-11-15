"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const memory_diag_1 = require("./memory_diag");
const MB = 1024 * 1024;
(0, node_test_1.describe)("memory_diag", () => {
    (0, node_test_1.it)("meldet unauffällig bei kleinem Speicher", () => {
        const d = (0, memory_diag_1.buildMemoryDiagnostics)({ rss: 150 * MB, heapUsed: 60 * MB, heapTotal: 80 * MB, external: 5 * MB, arrayBuffers: 1 * MB }, 0, 600, 0);
        strict_1.default.equal(d.rssMb, 150);
        strict_1.default.equal(d.outsideHeapMb, 70);
        strict_1.default.match(d.hintDe, /unauffällig/);
    });
    (0, node_test_1.it)("erkennt Puffer als Ursache und merkt den Spitzenwert", () => {
        const d = (0, memory_diag_1.buildMemoryDiagnostics)({ rss: 600 * MB, heapUsed: 120 * MB, heapTotal: 170 * MB, external: 300 * MB, arrayBuffers: 200 * MB }, 0, 3600, 700);
        strict_1.default.match(d.hintDe, /Puffern/);
        strict_1.default.equal(d.rssPeakMb, 700);
    });
    (0, node_test_1.it)("erkennt Fragmentierung, wenn weder Heap noch Puffer groß sind", () => {
        const d = (0, memory_diag_1.buildMemoryDiagnostics)({ rss: 600 * MB, heapUsed: 120 * MB, heapTotal: 170 * MB, external: 10 * MB, arrayBuffers: 2 * MB }, 0, 3600, 0);
        strict_1.default.match(d.hintDe, /Fragmentierung/);
    });
});
