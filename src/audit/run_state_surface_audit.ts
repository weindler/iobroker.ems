/**
 * Read-only CLI: summarize known state-surface families.
 * Does not touch ioBroker objects.
 *
 * Usage: node build/audit/run_state_surface_audit.js
 */
import { STATE_SURFACE_FAMILIES, summarizeStateSurfaceCatalog } from "./state_surface_catalog";

function main(): void {
	const summary = summarizeStateSurfaceCatalog();
	console.log("EMS-Light Phase 4A — State Surface Audit (read-only)");
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

main();
