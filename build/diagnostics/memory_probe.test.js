"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const memory_probe_js_1 = require("./memory_probe.js");
(0, node_test_1.describe)("memory_probe", () => {
    (0, node_test_1.it)("captures process and v8 stats in MiB", () => {
        const snap = (0, memory_probe_js_1.captureMemoryProbe)("test");
        strict_1.default.equal(snap.checkpoint, "test");
        strict_1.default.ok(snap.rssMiB > 0);
        strict_1.default.ok(snap.heapUsedMiB >= 0);
        strict_1.default.ok(snap.v8HeapSizeLimitMiB > 0);
        const line = (0, memory_probe_js_1.formatMemoryProbeLine)(snap);
        strict_1.default.match(line, /^EMS mem\[test\] rss=/);
        strict_1.default.doesNotMatch(line, /\/home\//);
    });
    (0, node_test_1.it)("computes deltas between checkpoints", () => {
        const a = (0, memory_probe_js_1.captureMemoryProbe)("a");
        const b = (0, memory_probe_js_1.captureMemoryProbe)("b");
        const delta = (0, memory_probe_js_1.memoryProbeDelta)(a, b);
        strict_1.default.equal(typeof delta.rssMiB, "number");
        strict_1.default.equal(typeof delta.heapUsedMiB, "number");
    });
    (0, node_test_1.it)("converts Linux maxRSS KiB to MiB", () => {
        strict_1.default.equal((0, memory_probe_js_1.maxRssToMiBForTest)(573440, "linux"), 560);
    });
    (0, node_test_1.it)("converts Windows maxRSS bytes to MiB", () => {
        strict_1.default.equal((0, memory_probe_js_1.maxRssToMiBForTest)(1048576, "win32"), 1);
    });
});
