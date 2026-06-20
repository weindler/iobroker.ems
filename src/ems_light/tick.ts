import { GLOBAL } from "../tree_paths";
import {
	deriveHealth,
	formatLiveCacheSummary,
	refreshLiveCache,
	type LiveCacheHost,
} from "./live_cache";

export async function runEmsLightPhase1Tick(host: LiveCacheHost): Promise<void> {
	const ts = new Date().toISOString();
	const hints: string[] = [];

	let executionMode = "dryrun";
	try {
		const globalMode = await host.getStateAsync(GLOBAL.executionMode);
		if (globalMode?.val != null && String(globalMode.val).trim() !== "") {
			executionMode = String(globalMode.val).trim().toLowerCase();
		} else {
			hints.push("global.execution_mode nicht gesetzt");
		}
	} catch {
		hints.push("global.execution_mode nicht lesbar");
	}

	try {
		await host.setStateAsync("execution.safety.global_execution_mode", {
			val: executionMode,
			ack: true,
		});
	} catch (e) {
		hints.push(`execution.safety.global_execution_mode: ${String(e)}`);
	}

	let liveResult = { updated: [] as string[], missing: [] as string[], errors: [] as string[] };
	try {
		liveResult = await refreshLiveCache(host);
	} catch (e) {
		hints.push(`live_cache: ${String(e)}`);
		liveResult.errors.push(String(e));
	}

	const health = deriveHealth(liveResult, !hints.some((h) => h.includes("global.execution_mode nicht")));
	const summaryParts = [
		`Phase 1 read-only. Modus=${executionMode}.`,
		formatLiveCacheSummary(liveResult),
		...hints,
	];

	try {
		await host.setStateAsync("system.last_tick_at", { val: ts, ack: true });
		await host.setStateAsync("system.health", { val: health, ack: true });
		await host.setStateAsync("execution.safety.summary_de", {
			val: summaryParts.join(" ").trim().slice(0, 480),
			ack: true,
		});
	} catch {
		// kein Throw — Phase 1 soll robust bleiben
	}
}
