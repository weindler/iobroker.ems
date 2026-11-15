import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendNotifyTest, sendPush, type NotifyHost } from "./index";

function host(sent: unknown[], withSend = true): NotifyHost {
	return {
		config: { notify_instance: "pushover.0" },
		log: { warn: () => undefined },
		getStateAsync: async () => null,
		setStateAsync: async () => undefined,
		sendTo: withSend ? (i: string, m: unknown) => void sent.push([i, m]) : undefined,
	};
}

describe("notify sendPush", () => {
	it("sendet ohne auf eine Antwort zu warten", async () => {
		const sent: unknown[] = [];
		await sendPush(host(sent), "pushover.0", { title: "T", message: "M", priority: 0 });
		assert.deepEqual(sent, [["pushover.0", { message: "M", title: "T", priority: 0 }]]);
	});
	it("Testnachricht meldet Erfolg und Fehler", async () => {
		const sent: unknown[] = [];
		assert.equal((await sendNotifyTest(host(sent))).ok, true);
		assert.equal(sent.length, 1);
		assert.equal((await sendNotifyTest(host([], false))).ok, false);
	});
});
