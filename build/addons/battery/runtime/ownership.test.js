"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const ownership_js_1 = require("./ownership.js");
(0, node_test_1.describe)("battery ownership", () => {
    (0, node_test_1.it)("no restore without ownership", () => {
        strict_1.default.equal((0, ownership_js_1.canSafeRestore)((0, ownership_js_1.emptyOwnership)()), false);
    });
    (0, node_test_1.it)("restore allowed when EMS wrote manual mode", () => {
        const o = { ...(0, ownership_js_1.emptyOwnership)(), active: true, manualModeWritten: true };
        strict_1.default.equal((0, ownership_js_1.canSafeRestore)(o), true);
    });
    (0, node_test_1.it)("foreign manual control detected at startup", () => {
        strict_1.default.equal((0, ownership_js_1.isForeignManualControl)({ currentMode: 1, manualModeValue: 1, ownership: (0, ownership_js_1.emptyOwnership)() }), true);
    });
    (0, node_test_1.it)("not foreign when EMS owns", () => {
        const o = { ...(0, ownership_js_1.emptyOwnership)(), active: true };
        strict_1.default.equal((0, ownership_js_1.isForeignManualControl)({ currentMode: 1, manualModeValue: 1, ownership: o }), false);
    });
});
