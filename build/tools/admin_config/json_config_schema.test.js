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
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const validate_json_config_1 = require("./validate_json_config");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCHEMA_PATH = path.join(ROOT, "src/tools/admin_config/iobroker_jsonConfig.schema.json");
const CONFIG_PATH = path.join(ROOT, "admin/jsonConfig.json");
function loadJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
(0, node_test_1.describe)("admin jsonConfig vs ioBroker schema", () => {
    const schema = loadJson(SCHEMA_PATH);
    const config = loadJson(CONFIG_PATH);
    (0, node_test_1.it)("sendTo darf alsoDependsOn laut Schema nicht haben", () => {
        const sendTo = schema.definitions?.sendToProps?.properties ?? {};
        strict_1.default.equal("alsoDependsOn" in sendTo, false, "sendToProps must not list alsoDependsOn");
        strict_1.default.ok("command" in sendTo);
        strict_1.default.ok("disabled" in sendTo);
    });
    (0, node_test_1.it)("gesamte jsonConfig ist gegen das ioBroker-Schema additionalProperties-valid", () => {
        const issues = (0, validate_json_config_1.validateJsonConfig)(config, schema);
        strict_1.default.deepEqual(issues, [], issues.map((i) => `${i.path} ${i.property ?? ""}: ${i.message}`).join("\n"));
    });
    (0, node_test_1.it)("normale Admin-Konfiguration enthält keine KI-Bedienelemente oder Secrets", () => {
        const serialized = JSON.stringify(config);
        strict_1.default.equal(serialized.includes("ai_openai_api_key"), false);
        strict_1.default.equal(serialized.includes("aiDailyAnalystNow"), false);
        strict_1.default.equal(serialized.includes("KI-Optimierung"), false);
    });
    (0, node_test_1.it)("zeigt jeden Laufzeitmodus als großen Ist-Status und direkte Sofort-Schaltflächen", () => {
        const all = config.items ?? {};
        const expected = [
            ["globalTab", "global_execution_mode", "global.execution_mode"],
            ["wallboxTab", "wb_addon_mode", "addons.wallbox.mode"],
            ["batteryTab", "bat_addon_mode", "addons.battery.mode"],
            ["immersionHeaterTab", "ih_addon_mode", "addons.immersion_heater.mode"],
            ["climateTab", "ac_addon_mode", "addons.air_conditioning.mode"],
        ];
        for (const [tab, key, oid] of expected) {
            const item = all[tab]?.items?.[key];
            strict_1.default.equal(item?.type, "panel", `${key} muss als eindeutiger Modusblock erscheinen`);
            const modeItems = item?.items;
            strict_1.default.equal(modeItems?.current?.type, "state");
            strict_1.default.equal(modeItems?.current?.oid, oid);
            strict_1.default.equal(modeItems?.current?.control, "text");
            for (const mode of key === "global_execution_mode" ? ["dryrun", "live"] : ["off", "dryrun", "live"]) {
                strict_1.default.equal(modeItems?.[mode]?.type, "state");
                strict_1.default.equal(modeItems?.[mode]?.oid, oid);
                strict_1.default.equal(modeItems?.[mode]?.control, "button");
                strict_1.default.equal(modeItems?.[mode]?.buttonValue, mode);
            }
        }
        const serialized = JSON.stringify(config);
        strict_1.default.equal(serialized.includes("runtime_global_mode_apply"), false);
        strict_1.default.equal(serialized.includes("runtime_wallbox_mode_apply"), false);
    });
});
