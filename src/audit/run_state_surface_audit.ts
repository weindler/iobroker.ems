/**
 * Read-only CLI: summarize known state-surface families.
 * Optional: analyze an exported ioBroker object-tree JSON dump (no live connection).
 *
 * Usage:
 *   node build/audit/run_state_surface_audit.js
 *   node build/audit/run_state_surface_audit.js --dump path/to/objects.json
 *   node build/audit/run_state_surface_audit.js --dump path/to/objects.json --write-docs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { STATE_SURFACE_FAMILIES, summarizeStateSurfaceCatalog } from "./state_surface_catalog";
import { analyzeObjectDump, formatDumpAnalysisMarkdown } from "./analyze_object_dump";

function parseArgs(argv: string[]): { dumpPath: string | null; writeDocs: boolean; jsonOut: string | null } {
	let dumpPath: string | null = null;
	let writeDocs = false;
	let jsonOut: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--dump" && argv[i + 1]) {
			dumpPath = argv[++i];
		} else if (a === "--write-docs") {
			writeDocs = true;
		} else if (a === "--json-out" && argv[i + 1]) {
			jsonOut = argv[++i];
		} else if (a === "--help" || a === "-h") {
			console.log(
				"Usage: run_state_surface_audit.js [--dump objects.json] [--write-docs] [--json-out tmp/report.json]",
			);
			process.exit(0);
		}
	}
	return { dumpPath, writeDocs, jsonOut };
}

function printCatalog(): void {
	const summary = summarizeStateSurfaceCatalog();
	console.log("EMS-Light Phase 4 — State Surface Audit (read-only)");
	console.log(`Families: ${summary.familyCount}`);
	console.log(`Estimated static leaf states (code catalog): ${summary.estimatedStaticTotal}`);
	console.log(
		"Note: live instances often exceed this via vehicles, AC units/mappings, disabled-device trees (~1500+ observed).",
	);
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
	for (const f of STATE_SURFACE_FAMILIES) {
		console.log(
			`- ${f.id} [${f.targetClass}] ~${f.estimatedStaticCount} | ${f.idPattern}${
				f.dynamicNote ? ` | dynamic: ${f.dynamicNote}` : ""
			}`,
		);
	}
}

function main(): void {
	const { dumpPath, writeDocs, jsonOut } = parseArgs(process.argv.slice(2));
	printCatalog();

	if (!dumpPath) {
		console.log("");
		console.log("Tip: pass --dump <objects.json> to compare a production object export (read-only).");
		return;
	}

	const abs = resolve(dumpPath);
	const raw = JSON.parse(readFileSync(abs, "utf8")) as unknown;
	const analysis = analyzeObjectDump(raw);
	const md = formatDumpAnalysisMarkdown(analysis);

	console.log("");
	console.log("--- Dump analysis ---");
	console.log(`Namespace: ${analysis.namespace ?? "(relative)"}`);
	console.log(`Objects: ${analysis.totalObjects} | States: ${analysis.totalStates} | Gap vs catalog: ${analysis.gapVsCatalog}`);
	for (const note of analysis.explainedGapNotes) {
		console.log(`  ${note}`);
	}
	console.log(`Unknown prefix groups: ${analysis.unknownPrefixGroups.length}`);

	if (jsonOut) {
		const outAbs = resolve(jsonOut);
		mkdirSync(dirname(outAbs), { recursive: true });
		writeFileSync(
			outAbs,
			JSON.stringify(
				{
					generatedAt: new Date().toISOString(),
					sourceDump: abs,
					analysis: {
						...analysis,
						// Explicit: no object contents / values
					},
				},
				null,
				2,
			),
			"utf8",
		);
		console.log(`Wrote JSON report: ${outAbs}`);
	}

	if (writeDocs) {
		// Nicht unter docs/ committen — Audit-Arbeitsbericht lokal/CI.
		const docPath = resolve("state-surface-production-gap.local.md");
		writeFileSync(docPath, md, "utf8");
		console.log(`Wrote ${docPath} (local only — do not commit under docs/)`);
	} else {
		console.log("");
		console.log("Pass --write-docs to write state-surface-production-gap.local.md (not under docs/)");
	}
}

main();
