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
const persistence_mirror_1 = require("./persistence_mirror");
function makeHost(baseDir) {
    const states = new Map();
    const objects = new Set();
    return {
        states,
        objects,
        getAbsolutePath: (category) => (category ? path.join(baseDir, category) : baseDir),
        setObjectNotExistsAsync: async (id) => {
            objects.add(id);
            return undefined;
        },
        getStateAsync: async (id) => {
            const s = states.get(id);
            return s ? { val: s.val, ack: s.ack, ts: 0, lc: 0, from: "test" } : null;
        },
        setStateAsync: async (id, state) => {
            states.set(id, { val: state.val, ack: state.ack ?? false });
            return undefined;
        },
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    };
}
const BAT_DIR = "learning/battery_runtime";
const BAT_FILE = "battery_runtime_learning_v1.json";
const BAT_STATE = "learning.persistence.battery_runtime_json";
(0, node_test_1.describe)("learning persistence mirror", () => {
    let tmp;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-persist-"));
    });
    (0, node_test_1.afterEach)(async () => {
        await fs.rm(tmp, { recursive: true, force: true });
    });
    (0, node_test_1.it)("ensures lean status states only (no large json mirrors)", async () => {
        const host = makeHost(tmp);
        await (0, persistence_mirror_1.ensureLearningPersistenceStates)(host);
        strict_1.default.ok(host.objects.has("learning.persistence"));
        strict_1.default.ok(host.objects.has("learning.persistence.last_mirror"));
        strict_1.default.ok(host.objects.has("learning.persistence.last_restore"));
        strict_1.default.ok(host.objects.has("learning.persistence.files_present"));
        strict_1.default.equal(host.objects.has(BAT_STATE), false);
    });
    (0, node_test_1.it)("status tick counts files without writing json mirrors", async () => {
        const host = makeHost(tmp);
        const dir = path.join(tmp, BAT_DIR);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, BAT_FILE), `${JSON.stringify({ sample_days: 5 })}\n`, "utf8");
        await (0, persistence_mirror_1.mirrorLearningPersistenceToStates)(host);
        strict_1.default.equal(host.states.get(BAT_STATE), undefined);
        strict_1.default.equal(host.states.get("learning.persistence.files_present")?.val, 1);
        strict_1.default.ok(host.states.get("learning.persistence.last_mirror"));
    });
    (0, node_test_1.it)("restores a missing file from a legacy mirror state", async () => {
        const host = makeHost(tmp);
        const payload = JSON.stringify({ sample_days: 9 });
        host.states.set(BAT_STATE, { val: payload, ack: true });
        await (0, persistence_mirror_1.restoreLearningPersistenceFromStates)(host);
        const restored = await fs.readFile(path.join(tmp, BAT_DIR, BAT_FILE), "utf8");
        strict_1.default.equal(JSON.parse(restored).sample_days, 9);
        strict_1.default.ok(host.states.get("learning.persistence.last_restore"));
    });
    (0, node_test_1.it)("does not overwrite an existing file on restore", async () => {
        const host = makeHost(tmp);
        const dir = path.join(tmp, BAT_DIR);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, BAT_FILE), JSON.stringify({ sample_days: 1 }), "utf8");
        host.states.set(BAT_STATE, { val: JSON.stringify({ sample_days: 99 }), ack: true });
        await (0, persistence_mirror_1.restoreLearningPersistenceFromStates)(host);
        const onDisk = await fs.readFile(path.join(dir, BAT_FILE), "utf8");
        strict_1.default.equal(JSON.parse(onDisk).sample_days, 1);
    });
});
