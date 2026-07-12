import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	captureMemoryProbe,
	formatMemoryProbeLine,
	maxRssToMiBForTest,
	memoryProbeDelta,
} from "./memory_probe.js";

describe("memory_probe", () => {
	it("captures process and v8 stats in MiB", () => {
		const snap = captureMemoryProbe("test");
		assert.equal(snap.checkpoint, "test");
		assert.ok(snap.rssMiB > 0);
		assert.ok(snap.heapUsedMiB >= 0);
		assert.ok(snap.v8HeapSizeLimitMiB > 0);
		const line = formatMemoryProbeLine(snap);
		assert.match(line, /^EMS mem\[test\] rss=/);
		assert.doesNotMatch(line, /\/home\//);
	});

	it("computes deltas between checkpoints", () => {
		const a = captureMemoryProbe("a");
		const b = captureMemoryProbe("b");
		const delta = memoryProbeDelta(a, b);
		assert.equal(typeof delta.rssMiB, "number");
		assert.equal(typeof delta.heapUsedMiB, "number");
	});

	it("converts Linux maxRSS KiB to MiB", () => {
		assert.equal(maxRssToMiBForTest(573440, "linux"), 560);
	});

	it("converts Windows maxRSS bytes to MiB", () => {
		assert.equal(maxRssToMiBForTest(1048576, "win32"), 1);
	});
});
