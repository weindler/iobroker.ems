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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_test_1 = require("node:test");
const collect_config_1 = require("./collect_config");
const schema_1 = require("./schema");
/** Felder im Admin, die keine gespeicherte Einstellung sind (Knöpfe, Anzeigen, Auswahl-Hilfen). */
const UI_ONLY = new Set([
    "_storageReportResult",
    "confirm",
    "current",
    "diagnostic_duration_min",
    "dryrun",
    "energyforecastLink",
    "live",
    "off",
    "restore_selected_file",
]);
const NON_DATA_TYPES = new Set(["panel", "header", "staticText", "sendTo", "divider", "tabs", "accordion", "alive", "infoBox"]);
function collectConfigKeys(node, out) {
    if (!node || typeof node !== "object")
        return;
    for (const [k, v] of Object.entries(node)) {
        if (v && typeof v === "object" && !Array.isArray(v) && typeof v.type === "string") {
            if (!NON_DATA_TYPES.has(v.type) && !/^\d+$/.test(k))
                out.add(k);
        }
        collectConfigKeys(v, out);
    }
}
(0, node_test_1.describe)("Backup deckt alle Admin-Einstellungen ab", () => {
    (0, node_test_1.it)("jede Einstellung ist im Backup erlaubt, ein Geheimnis oder nur eine Anzeige", () => {
        const raw = fs.readFileSync(path.join(__dirname, "../../admin/jsonConfig.json"), "utf8");
        const keys = new Set();
        collectConfigKeys(JSON.parse(raw), keys);
        const missing = [...keys].filter((k) => !UI_ONLY.has(k) && !(0, schema_1.isSecretKey)(k) && !(0, collect_config_1.isAllowedConfigKey)(k)).sort();
        strict_1.default.deepEqual(missing, [], `Nicht im Backup: ${missing.join(", ")}`);
    });
    (0, node_test_1.it)("Tokens und Passwörter bleiben draußen", () => {
        strict_1.default.equal((0, collect_config_1.isAllowedConfigKey)("energyforecast_token"), false);
        strict_1.default.equal((0, collect_config_1.isAllowedConfigKey)("ai_openai_api_key"), false);
        strict_1.default.equal((0, collect_config_1.isAllowedConfigKey)("notify_enabled"), true);
        strict_1.default.equal((0, collect_config_1.isAllowedConfigKey)("statistics_compare_tariff_ct_per_kwh"), true);
    });
});
