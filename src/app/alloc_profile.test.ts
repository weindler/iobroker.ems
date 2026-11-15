import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeAllocProfile } from "./alloc_profile";

const MB = 1_048_576;
describe("alloc_profile", () => {
	it("fasst den Profilbaum nach Funktion und Datei zusammen", () => {
		const head = {
			callFrame: { functionName: "(root)", url: "", lineNumber: 0 },
			selfSize: 0,
			children: [
				{ callFrame: { functionName: "parseBig", url: "file:///x/build/statistics/tick.js", lineNumber: 9 }, selfSize: 6 * MB },
				{ callFrame: { functionName: "parseBig", url: "file:///x/build/statistics/tick.js", lineNumber: 9 }, selfSize: 2 * MB },
				{ callFrame: { functionName: "small", url: "file:///x/build/a.js", lineNumber: 1 }, selfSize: 1 * MB },
			],
		};
		const r = summarizeAllocProfile(head);
		assert.equal(r.totalMb, 9);
		assert.equal(r.top[0]!.fn, "parseBig");
		assert.equal(r.top[0]!.mb, 8);
		assert.equal(r.top[0]!.line, 10);
		assert.equal(r.topFiles[0]!.file, "statistics/tick.js");
	});
});
