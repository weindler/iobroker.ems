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
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageReportHtml = exports.storageReportText = exports.buildStorageReport = exports.growthPerDay = exports.ensureStorageReportStates = exports.STORAGE_REPORT_HTML_STATE = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const state_util_1 = require("./ems_light/state_util");
exports.STORAGE_REPORT_HTML_STATE = "storage.report_html";
const HISTORY_FILE = "storage_report_history_v1.json";
async function ensureStorageReportStates(host) {
    await (0, state_util_1.ensureChannel)(host, "storage", "Speicher und Aufbewahrung");
    await (0, state_util_1.ensureStates)(host, [{
            id: exports.STORAGE_REPORT_HTML_STATE,
            common: { name: "Speicherbericht", type: "string", role: "html", read: true, write: false, def: "" },
            defaultVal: "<div>Noch keine Berechnung durchgeführt.</div>",
        }]);
}
exports.ensureStorageReportStates = ensureStorageReportStates;
function retentionForCategory(category) {
    const key = category.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (key.includes("day_telemetry") || key.includes("daily_evaluator") || key.includes("shadow"))
        return "90 Tage";
    if (key.includes("energy_daily") || key.includes("energy_rollup"))
        return "730 Tage";
    if (key.includes("statistics") || key.includes("economics"))
        return "10 Jahre (3.660 Tage)";
    if (key.includes("measured_consumer"))
        return "400 Tage";
    if (key.includes("backup"))
        return "maximal 10 Dateien";
    if (key.includes("support"))
        return "maximal 5 Dateien";
    if (key.includes("learning") || key.includes("weather") || key.includes("power_rollup") || key.includes("price"))
        return "meist 120 Tage bzw. modellbegrenzt";
    return "datenartspezifisch begrenzt";
}
async function scan(root) {
    let bytes = 0, files = 0;
    const byCategory = {};
    const raw = {};
    const errors = [];
    async function walk(dir, category) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        }
        catch (error) {
            errors.push(`${path.relative(root, dir) || "."}: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink() || entry.name === HISTORY_FILE)
                continue;
            const full = path.join(dir, entry.name);
            const top = category || entry.name;
            if (entry.isDirectory()) {
                await walk(full, top);
                continue;
            }
            if (!entry.isFile())
                continue;
            try {
                const stat = await fs.stat(full);
                bytes += stat.size;
                files++;
                byCategory[top] = (byCategory[top] ?? 0) + stat.size;
                const item = raw[top] ?? { bytes: 0, files: 0, oldestMs: null, newestMs: null };
                item.bytes += stat.size;
                item.files++;
                item.oldestMs = item.oldestMs === null ? stat.mtimeMs : Math.min(item.oldestMs, stat.mtimeMs);
                item.newestMs = item.newestMs === null ? stat.mtimeMs : Math.max(item.newestMs, stat.mtimeMs);
                raw[top] = item;
            }
            catch (error) {
                errors.push(`${path.relative(root, full)}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    await walk(root, "");
    const categories = {};
    for (const [name, item] of Object.entries(raw))
        categories[name] = {
            bytes: item.bytes, files: item.files,
            oldestIso: item.oldestMs === null ? null : new Date(item.oldestMs).toISOString(),
            newestIso: item.newestMs === null ? null : new Date(item.newestMs).toISOString(),
            retentionDe: retentionForCategory(name),
        };
    return { bytes, files, byCategory, categories, errors };
}
async function updateHistory(root, bytes, nowMs) {
    const file = path.join(root, HISTORY_FILE);
    let samples = [];
    try {
        const parsed = JSON.parse(await fs.readFile(file, "utf8"));
        if (Array.isArray(parsed))
            samples = parsed.filter((s) => !!s && Number.isFinite(s.ts) && Number.isFinite(s.bytes));
    }
    catch { /* erster Lauf */ }
    const day = new Date(nowMs).toISOString().slice(0, 10);
    const idx = samples.findIndex((s) => new Date(s.ts).toISOString().slice(0, 10) === day);
    if (idx >= 0)
        samples[idx] = { ts: nowMs, bytes };
    else
        samples.push({ ts: nowMs, bytes });
    samples = samples.filter((s) => nowMs - s.ts <= 120 * 86_400_000).sort((a, b) => a.ts - b.ts).slice(-120);
    await fs.writeFile(file, JSON.stringify(samples), { mode: 0o600 });
    return samples;
}
function growthPerDay(samples) {
    if (samples.length < 3)
        return null;
    const first = samples[0], last = samples[samples.length - 1];
    const days = (last.ts - first.ts) / 86_400_000;
    return days < 2 ? null : Math.max(0, (last.bytes - first.bytes) / days);
}
exports.growthPerDay = growthPerDay;
async function buildStorageReport(root, now = new Date()) {
    await fs.mkdir(root, { recursive: true });
    const measured = await scan(root);
    const disk = await fs.statfs(root);
    const freeBytes = Number(disk.bavail) * Number(disk.bsize);
    const growthBytesPerDay = growthPerDay(await updateHistory(root, measured.bytes, now.getTime()));
    const projection = (days) => growthBytesPerDay === null ? null : measured.bytes + growthBytesPerDay * days;
    const projectedBytes = { "30": projection(30), "90": projection(90), "365": projection(365), "730": projection(730) };
    const ratio = freeBytes > 0 ? (projectedBytes["730"] ?? measured.bytes) / freeBytes : 1;
    const statusDe = ratio >= 0.8 ? "Speicher könnte knapp werden" : ratio >= 0.35 ? "beobachten" : "unkritisch";
    return { ...measured, freeBytes, growthBytesPerDay, projectedBytes, statusDe, calculatedAtIso: now.toISOString() };
}
exports.buildStorageReport = buildStorageReport;
function storageReportText(report) {
    const mb = (v) => v === null ? "noch nicht berechenbar" : `${Math.round(v / 1024 / 1024 * 10) / 10} MB`;
    const gb = (v) => `${Math.round(v / 1024 / 1024 / 1024 * 10) / 10} GB`;
    return `EMS aktuell: ${mb(report.bytes)} in ${report.files} Dateien · Datenträger frei: ${gb(report.freeBytes)} · Wachstum pro Tag: ${mb(report.growthBytesPerDay)} · Bewertung: ${report.statusDe}`;
}
exports.storageReportText = storageReportText;
function storageReportHtml(report) {
    const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
    const mb = (v) => v === null ? "Noch nicht genügend Daten für eine Hochrechnung" : `${Math.round(v / 1024 / 1024 * 10) / 10} MB`;
    const gb = (v) => `${Math.round(v / 1024 / 1024 / 1024 * 10) / 10} GB`;
    const color = report.statusDe === "unkritisch" ? "#2e7d32" : report.statusDe === "beobachten" ? "#ed6c02" : "#d32f2f";
    const row = (label, value) => `<tr><td style="padding:6px 12px 6px 0;color:#666">${label}</td><td style="padding:6px 0;font-weight:600">${value}</td></tr>`;
    const categoryRows = Object.entries(report.categories).sort((a, b) => b[1].bytes - a[1].bytes).map(([name, item]) => `<tr><td>${esc(name)}</td><td>${esc(mb(item.bytes))}</td><td>${item.files}</td><td>${esc(item.retentionDe)}</td><td>${esc(item.oldestIso ? new Date(item.oldestIso).toLocaleDateString("de-DE") : "—")} – ${esc(item.newestIso ? new Date(item.newestIso).toLocaleDateString("de-DE") : "—")}</td></tr>`).join("") || `<tr><td colspan="5">Noch keine EMS-Dateien gefunden.</td></tr>`;
    return `<div style="border:1px solid #bbb;border-left:5px solid ${color};border-radius:5px;padding:12px;margin-top:8px"><div style="font-size:18px;font-weight:700">Speicherbericht: <span style="color:${color}">${esc(report.statusDe)}</span></div><table><tbody>${row("Aktuell belegt", `${mb(report.bytes)} in ${report.files} Dateien`)}${row("Datenträger frei", gb(report.freeBytes))}${row("Wachstum pro Tag", mb(report.growthBytesPerDay))}${row("Hochrechnung 30/90/365/730 Tage", `${mb(report.projectedBytes["30"])} / ${mb(report.projectedBytes["90"])} / ${mb(report.projectedBytes["365"])} / ${mb(report.projectedBytes["730"])}`)}${row("Letzte Berechnung", new Date(report.calculatedAtIso).toLocaleString("de-DE"))}</tbody></table><div style="font-size:16px;font-weight:700;margin-top:12px">Belegung nach Datenart</div><table style="width:100%"><thead><tr><th>Datenart</th><th>Größe</th><th>Dateien</th><th>Aufbewahrung</th><th>älteste – neueste Datei</th></tr></thead><tbody>${categoryRows}</tbody></table><div style="margin-top:6px;color:${report.errors.length ? "#d32f2f" : "#2e7d32"}">${report.errors.length ? `Lesefehler: ${esc(report.errors.join("; "))}` : "Alle EMS-Verzeichnisse konnten gelesen werden."}</div></div>`;
}
exports.storageReportHtml = storageReportHtml;
