"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const alloc_profile_1 = require("./alloc_profile");
const MB = 1_048_576;
(0, node_test_1.describe)("alloc_profile", () => {
    (0, node_test_1.it)("fasst den Profilbaum nach Funktion und Datei zusammen", () => {
        const head = {
            callFrame: { functionName: "(root)", url: "", lineNumber: 0 },
            selfSize: 0,
            children: [
                { callFrame: { functionName: "parseBig", url: "file:///x/build/statistics/tick.js", lineNumber: 9 }, selfSize: 6 * MB },
                { callFrame: { functionName: "parseBig", url: "file:///x/build/statistics/tick.js", lineNumber: 9 }, selfSize: 2 * MB },
                { callFrame: { functionName: "small", url: "file:///x/build/a.js", lineNumber: 1 }, selfSize: 1 * MB },
            ],
        };
        const r = (0, alloc_profile_1.summarizeAllocProfile)(head);
        strict_1.default.equal(r.totalMb, 9);
        strict_1.default.equal(r.top[0].fn, "parseBig");
        strict_1.default.equal(r.top[0].mb, 8);
        strict_1.default.equal(r.top[0].line, 10);
        strict_1.default.equal(r.topFiles[0].file, "statistics/tick.js");
    });
});
