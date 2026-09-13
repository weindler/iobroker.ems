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
const storage_report_1 = require("./storage_report");
(0, node_test_1.describe)("Speicherbericht", () => {
    (0, node_test_1.it)("erfindet ohne mindestens drei Messtage keine Hochrechnung", () => {
        strict_1.default.equal((0, storage_report_1.growthPerDay)([{ ts: 0, bytes: 100 }, { ts: 86_400_000, bytes: 200 }]), null);
    });
    (0, node_test_1.it)("berechnet gemessenes tägliches Wachstum", () => {
        strict_1.default.equal((0, storage_report_1.growthPerDay)([{ ts: 0, bytes: 100 }, { ts: 86_400_000, bytes: 200 }, { ts: 172_800_000, bytes: 300 }]), 100);
    });
    (0, node_test_1.it)("liefert sichtbar Datenarten, Zeitraum und Aufbewahrung statt nur OK", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ems-storage-"));
        try {
            await fs.mkdir(path.join(dir, "learning"), { recursive: true });
            await fs.writeFile(path.join(dir, "learning", "sample.json"), "{}");
            const report = await (0, storage_report_1.buildStorageReport)(dir, new Date("2026-09-13T12:00:00Z"));
            strict_1.default.equal(report.categories.learning?.files, 1);
            strict_1.default.match((0, storage_report_1.storageReportText)(report), /EMS aktuell/);
            const html = (0, storage_report_1.storageReportHtml)(report);
            strict_1.default.match(html, /Belegung nach Datenart/);
            strict_1.default.match(html, /Noch nicht genügend Daten/);
            strict_1.default.match(html, /Aufbewahrung/);
            strict_1.default.doesNotMatch(html, /^OK$/i);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
