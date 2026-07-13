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
const os = __importStar(require("node:os"));
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const path = __importStar(require("node:path"));
const node_fs_1 = require("node:fs");
const builder_js_1 = require("./builder.js");
const source_js_1 = require("./source.js");
const iobroker_source_js_1 = require("./iobroker_source.js");
const config_from_adapter_js_1 = require("./config_from_adapter.js");
const from_iobroker_js_1 = require("./from_iobroker.js");
const parity_fixture_js_1 = require("./parity_fixture.js");
const allowed_paths_js_1 = require("./allowed_paths.js");
const allowed_paths_js_2 = require("./allowed_paths.js");
const coverage_js_1 = require("./coverage.js");
const constants_js_1 = require("./constants.js");
(0, node_test_1.describe)("iobroker planner snapshot source", () => {
    (0, node_test_1.it)("normalizes state values preserving 0, false, and empty string", () => {
        strict_1.default.deepEqual((0, iobroker_source_js_1.normalizeIoBrokerState)({ val: 0, ts: 1, ack: true }).value, 0);
        strict_1.default.deepEqual((0, iobroker_source_js_1.normalizeIoBrokerState)({ val: false, ts: 1, ack: true }).value, false);
        strict_1.default.deepEqual((0, iobroker_source_js_1.normalizeIoBrokerState)({ val: "", ts: 1, ack: true }).value, "");
    });
    (0, node_test_1.it)("normalizes missing state as null", () => {
        strict_1.default.deepEqual((0, iobroker_source_js_1.normalizeIoBrokerState)(null).value, null);
        strict_1.default.deepEqual((0, iobroker_source_js_1.normalizeIoBrokerState)(undefined).value, null);
    });
    (0, node_test_1.it)("normalizes foreign state values", async () => {
        const host = (0, parity_fixture_js_1.createParityIoBrokerHost)();
        const source = new iobroker_source_js_1.IoBrokerPlannerSnapshotSource(host);
        const st = await source.readForeignState("weather.0.forecast.current.temp");
        strict_1.default.equal(st.value, 19.2);
    });
    (0, node_test_1.it)("config whitelist excludes credentials", () => {
        const cfg = (0, config_from_adapter_js_1.plannerRelevantConfigFromHost)({
            config: {
                global_execution_mode: "dryrun",
                tibber_api_token: "secret-token",
                admin_password: "hunter2",
                learning_weather_forecast_temp_state: "a",
                learning_weather_actual_temp_state: "b",
            },
            getAbsolutePath: (c) => `/data/${c ?? ""}`,
        });
        strict_1.default.equal(cfg.executionMode, "dryrun");
        strict_1.default.ok(!JSON.stringify(cfg).includes("secret-token"));
        strict_1.default.ok(!JSON.stringify(cfg).includes("hunter2"));
    });
    (0, node_test_1.it)("config whitelist does not return native config object", () => {
        const native = { global_execution_mode: "live", nested: { token: "x" } };
        const cfg = (0, config_from_adapter_js_1.plannerRelevantConfigFromHost)({
            config: native,
            getAbsolutePath: () => "/data/x",
        });
        strict_1.default.notEqual(cfg, native);
        strict_1.default.equal(typeof cfg.timezone, "string");
    });
    (0, node_test_1.it)("readJsonFile rejects traversal paths", async () => {
        const host = {
            ...(0, parity_fixture_js_1.createParityIoBrokerHost)(),
            getAbsolutePath: (category) => `/tmp/ems-parity-test/${category ?? ""}`,
        };
        const source = new iobroker_source_js_1.IoBrokerPlannerSnapshotSource(host);
        const allowed = (0, allowed_paths_js_1.resolveAllowedPlannerJsonPath)(host.getAbsolutePath, "house_load_learning");
        await strict_1.default.rejects(() => source.readJsonFile(path.join(path.dirname(allowed), "..", allowed_paths_js_2.HOUSE_LOAD_LEARNING_FILE)), /planner snapshot file path not allowed|path outside allowed root/);
    });
    (0, node_test_1.it)("readJsonFile returns null for missing optional file", async () => {
        const tmpBase = path.join(os.tmpdir(), `ems-parity-json-${process.pid}`);
        const host = {
            ...(0, parity_fixture_js_1.createParityIoBrokerHost)(),
            getAbsolutePath: (category) => path.join(tmpBase, category ?? ""),
        };
        const source = new iobroker_source_js_1.IoBrokerPlannerSnapshotSource(host);
        const allowed = (0, allowed_paths_js_1.resolveAllowedPlannerJsonPath)(host.getAbsolutePath, "house_load_learning");
        const result = await source.readJsonFile(allowed);
        strict_1.default.equal(result, null);
    });
    (0, node_test_1.it)("readJsonFile fails closed when getAbsolutePath is missing", async () => {
        const source = new iobroker_source_js_1.IoBrokerPlannerSnapshotSource((0, parity_fixture_js_1.createParityIoBrokerHost)());
        await strict_1.default.rejects(() => source.readJsonFile("/tmp/house_load_learning_v1.json"), /getAbsolutePath unavailable/);
    });
    (0, node_test_1.it)("readJsonFile rejects empty getAbsolutePath root", () => {
        const host = {
            ...(0, parity_fixture_js_1.createParityIoBrokerHost)(),
            getAbsolutePath: () => "",
        };
        strict_1.default.throws(() => (0, allowed_paths_js_1.resolveAllowedPlannerJsonPath)(host.getAbsolutePath, "house_load_learning"), /empty planner snapshot root/);
    });
    (0, node_test_1.it)("readJsonFile rejects invalid JSON", async () => {
        const tmpBase = path.join(os.tmpdir(), `ems-parity-json-invalid-${process.pid}`);
        const host = {
            ...(0, parity_fixture_js_1.createParityIoBrokerHost)(),
            getAbsolutePath: (category) => path.join(tmpBase, category ?? ""),
        };
        const source = new iobroker_source_js_1.IoBrokerPlannerSnapshotSource(host);
        const allowed = (0, allowed_paths_js_1.resolveAllowedPlannerJsonPath)(host.getAbsolutePath, "house_load_learning");
        const { writeFile, mkdir } = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
        await mkdir(path.dirname(allowed), { recursive: true });
        await writeFile(allowed, "{not-json", { mode: 0o600 });
        await strict_1.default.rejects(() => source.readJsonFile(allowed), /invalid planner snapshot JSON/);
    });
    (0, node_test_1.it)("supports injectable clock", () => {
        const fixed = new Date("2026-01-15T08:00:00.000Z");
        const source = new iobroker_source_js_1.IoBrokerPlannerSnapshotSource((0, parity_fixture_js_1.createParityIoBrokerHost)(), () => fixed);
        strict_1.default.equal(source.now().toISOString(), fixed.toISOString());
    });
    (0, node_test_1.it)("cached source reads each id once through ioBroker host", async () => {
        let stateReads = 0;
        const host = (0, parity_fixture_js_1.createParityIoBrokerHost)();
        const wrapped = {
            ...host,
            getStateAsync: async (id) => {
                stateReads += 1;
                return host.getStateAsync(id);
            },
        };
        const cached = new source_js_1.CachedPlannerSnapshotSource(new iobroker_source_js_1.IoBrokerPlannerSnapshotSource(wrapped));
        await cached.readState("live.pv.power_w");
        await cached.readState("live.pv.power_w");
        await cached.readForeignState("weather.0.forecast.current.temp");
        await cached.readForeignState("weather.0.forecast.current.temp");
        strict_1.default.equal(stateReads, 1);
    });
});
(0, node_test_1.describe)("snapshot parity fixture vs ioBroker source", () => {
    (0, node_test_1.it)("produces identical snapshot and inputRevision", async () => {
        const direct = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const viaIo = await (0, from_iobroker_js_1.buildPlannerInputSnapshotFromIoBroker)((0, parity_fixture_js_1.createParityIoBrokerHost)(), {
            clock: () => new Date("2026-07-01T12:00:00.000Z"),
        });
        strict_1.default.equal(direct.inputRevision, viaIo.inputRevision);
        strict_1.default.deepEqual(direct, viaIo);
    });
    (0, node_test_1.it)("coverage matrix remains without unresolved", () => {
        (0, coverage_js_1.assertCoverageMatrixComplete)();
    });
    (0, node_test_1.it)("parity snapshot stays within budget", async () => {
        const snap = await (0, from_iobroker_js_1.buildPlannerInputSnapshotFromIoBroker)((0, parity_fixture_js_1.createParityIoBrokerHost)(), {
            clock: () => new Date("2026-07-01T12:00:00.000Z"),
        });
        const bytes = Buffer.byteLength(`${JSON.stringify(snap, null, 2)}\n`, "utf8");
        strict_1.default.ok(bytes <= constants_js_1.PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES);
    });
    (0, node_test_1.it)("serialized snapshot contains no configured absolute data paths", async () => {
        const tmpBase = path.join(os.tmpdir(), `ems-snapshot-paths-${process.pid}`);
        const host = {
            ...(0, parity_fixture_js_1.createParityIoBrokerHost)(),
            getAbsolutePath: (category) => path.join(tmpBase, category ?? ""),
        };
        const snap = await (0, from_iobroker_js_1.buildPlannerInputSnapshotFromIoBroker)(host, {
            clock: () => new Date("2026-07-01T12:00:00.000Z"),
        });
        const json = JSON.stringify(snap);
        strict_1.default.ok(!json.includes(tmpBase));
        strict_1.default.ok(!json.includes("dataPaths"));
        strict_1.default.ok(!json.includes("house_load_learning_v1.json"));
    });
});
(0, node_test_1.describe)("import boundaries", () => {
    (0, node_test_1.it)("iobroker source does not import adapter core or runtime engines", () => {
        const text = (0, node_fs_1.readFileSync)(path.join(process.cwd(), "src/planner_snapshot/iobroker_source.ts"), "utf8");
        for (const forbidden of ["adapter-core", "runtime/engine", "planner_worker/main", "ems_light"]) {
            strict_1.default.ok(!text.includes(forbidden), `iobroker_source must not reference ${forbidden}`);
        }
    });
});
