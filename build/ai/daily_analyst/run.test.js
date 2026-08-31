"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const run_1 = require("./run");
function silentProvider() {
    return {
        analyze: async () => {
            throw new Error("Provider darf bei disabled/no_token nicht aufgerufen werden");
        },
    };
}
function makeHost(config, dir) {
    const states = new Map();
    return {
        getAbsolutePath: () => dir,
        config,
        getStateAsync: async (id) => {
            if (!states.has(id))
                return null;
            return { val: states.get(id) };
        },
        setStateAsync: async (id, state) => {
            states.set(id, state.val);
        },
        setObjectNotExistsAsync: async () => undefined,
        log: { warn: () => undefined, debug: () => undefined, error: () => undefined },
    };
}
(0, node_test_1.describe)("runDailyAnalystForDate — EMS läuft ohne KI weiter", () => {
    (0, node_test_1.it)("status=disabled ohne Provider-Aufruf, wenn Admin-Modus disabled", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const r = await (0, run_1.runDailyAnalystForDate)(makeHost({ ai_analyst_mode: "disabled", ai_openai_api_key: "sk-test" }, dir), "2026-08-30", silentProvider());
        strict_1.default.equal(r.status, "disabled");
        strict_1.default.equal(r.ran, false);
        strict_1.default.equal(r.findings.length, 0);
    });
    (0, node_test_1.it)("status=no_token ohne Provider-Aufruf, wenn kein API-Key gesetzt ist", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const r = await (0, run_1.runDailyAnalystForDate)(makeHost({ ai_analyst_mode: "manual", ai_openai_api_key: "" }, dir), "2026-08-30", silentProvider());
        strict_1.default.equal(r.status, "no_token");
        strict_1.default.equal(r.ran, false);
        strict_1.default.equal(r.findings.length, 0);
    });
});
