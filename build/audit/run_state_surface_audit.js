"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Read-only CLI: summarize known state-surface families.
 * Optional: analyze an exported ioBroker object-tree JSON dump (no live connection).
 *
 * Usage:
 *   node build/audit/run_state_surface_audit.js
 *   node build/audit/run_state_surface_audit.js --dump path/to/objects.json
 *   node build/audit/run_state_surface_audit.js --dump path/to/objects.json --write-docs
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const state_surface_catalog_1 = require("./state_surface_catalog");
const analyze_object_dump_1 = require("./analyze_object_dump");
function parseArgs(argv) {
    let dumpPath = null;
    let writeDocs = false;
    let jsonOut = null;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dump" && argv[i + 1]) {
            dumpPath = argv[++i];
        }
        else if (a === "--write-docs") {
            writeDocs = true;
        }
        else if (a === "--json-out" && argv[i + 1]) {
            jsonOut = argv[++i];
        }
        else if (a === "--help" || a === "-h") {
            console.log("Usage: run_state_surface_audit.js [--dump objects.json] [--write-docs] [--json-out tmp/report.json]");
            process.exit(0);
        }
    }
    return { dumpPath, writeDocs, jsonOut };
}
function printCatalog() {
    const summary = (0, state_surface_catalog_1.summarizeStateSurfaceCatalog)();
    console.log("EMS-Light Phase 4 — State Surface Audit (read-only)");
    console.log(`Families: ${summary.familyCount}`);
    console.log(`Estimated static leaf states (code catalog): ${summary.estimatedStaticTotal}`);
    console.log("Note: live instances often exceed this via vehicles, AC units/mappings, disabled-device trees (~1500+ observed).");
    console.log("");
    console.log("By target class (estimated static counts):");
    for (const [cls, n] of Object.entries(summary.byClass)) {
        console.log(`  ${cls}: ${n}`);
    }
    console.log("");
    console.log("Largest families:");
    for (const f of summary.largestFamilies) {
        console.log(`  ${f.id}: ~${f.estimatedStaticCount}`);
    }
    console.log("");
    console.log("Family detail:");
    for (const f of state_surface_catalog_1.STATE_SURFACE_FAMILIES) {
        console.log(`- ${f.id} [${f.targetClass}] ~${f.estimatedStaticCount} | ${f.idPattern}${f.dynamicNote ? ` | dynamic: ${f.dynamicNote}` : ""}`);
    }
}
function main() {
    const { dumpPath, writeDocs, jsonOut } = parseArgs(process.argv.slice(2));
    printCatalog();
    if (!dumpPath) {
        console.log("");
        console.log("Tip: pass --dump <objects.json> to compare a production object export (read-only).");
        return;
    }
    const abs = (0, node_path_1.resolve)(dumpPath);
    const raw = JSON.parse((0, node_fs_1.readFileSync)(abs, "utf8"));
    const analysis = (0, analyze_object_dump_1.analyzeObjectDump)(raw);
    const md = (0, analyze_object_dump_1.formatDumpAnalysisMarkdown)(analysis);
    console.log("");
    console.log("--- Dump analysis ---");
    console.log(`Namespace: ${analysis.namespace ?? "(relative)"}`);
    console.log(`Objects: ${analysis.totalObjects} | States: ${analysis.totalStates} | Gap vs catalog: ${analysis.gapVsCatalog}`);
    for (const note of analysis.explainedGapNotes) {
        console.log(`  ${note}`);
    }
    console.log(`Unknown prefix groups: ${analysis.unknownPrefixGroups.length}`);
    if (jsonOut) {
        const outAbs = (0, node_path_1.resolve)(jsonOut);
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(outAbs), { recursive: true });
        (0, node_fs_1.writeFileSync)(outAbs, JSON.stringify({
            generatedAt: new Date().toISOString(),
            sourceDump: abs,
            analysis: {
                ...analysis,
                // Explicit: no object contents / values
            },
        }, null, 2), "utf8");
        console.log(`Wrote JSON report: ${outAbs}`);
    }
    if (writeDocs) {
        const docPath = (0, node_path_1.resolve)("docs/state-surface-production-gap.md");
        (0, node_fs_1.writeFileSync)(docPath, md, "utf8");
        console.log(`Wrote ${docPath}`);
    }
    else {
        console.log("");
        console.log("Pass --write-docs to refresh docs/state-surface-production-gap.md");
    }
}
main();
