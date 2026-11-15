"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const index_1 = require("./index");
function host(sent, withSend = true) {
    return {
        config: { notify_instance: "pushover.0" },
        log: { warn: () => undefined },
        getStateAsync: async () => null,
        setStateAsync: async () => undefined,
        sendTo: withSend ? (i, m) => void sent.push([i, m]) : undefined,
    };
}
(0, node_test_1.describe)("notify sendPush", () => {
    (0, node_test_1.it)("sendet ohne auf eine Antwort zu warten", async () => {
        const sent = [];
        await (0, index_1.sendPush)(host(sent), "pushover.0", { title: "T", message: "M", priority: 0 });
        strict_1.default.deepEqual(sent, [["pushover.0", { message: "M", title: "T", priority: 0 }]]);
    });
    (0, node_test_1.it)("Testnachricht meldet Erfolg und Fehler", async () => {
        const sent = [];
        strict_1.default.equal((await (0, index_1.sendNotifyTest)(host(sent))).ok, true);
        strict_1.default.equal(sent.length, 1);
        strict_1.default.equal((await (0, index_1.sendNotifyTest)(host([], false))).ok, false);
    });
});
