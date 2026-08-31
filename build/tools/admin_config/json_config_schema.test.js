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
    (0, node_test_1.it)("Daily-Analyst-Button JETZT ANALYSIEREN ist schema-konform und triggert aiDailyAnalystNow", () => {
        const btn = config.items?.globalTab?.items?.aiAnalystRunNowBtn;
        strict_1.default.ok(btn, "aiAnalystRunNowBtn fehlt");
        strict_1.default.equal(btn.type, "sendTo");
        strict_1.default.equal(btn.command, "aiDailyAnalystNow");
        strict_1.default.equal(btn.disabled, "data.ai_analyst_mode === 'disabled'");
        strict_1.default.equal("alsoDependsOn" in btn, false);
        const allowed = (0, validate_json_config_1.allowedKeysByType)(schema).get("sendTo");
        strict_1.default.ok(allowed, "sendTo keys aus Schema");
        strict_1.default.equal(allowed.has("alsoDependsOn"), false);
        for (const key of Object.keys(btn)) {
            strict_1.default.ok(allowed.has(key), `sendTo additionalProperty: ${key}`);
        }
    });
});
