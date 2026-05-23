import type { CommandIntent, PipelineOutcome } from "./types";

/**
 * v0.0.1: dryrun-only pipeline — no device writes.
 * Full chain: see EMS docs mapping_concept.md §5 (later versions).
 */
export function runDryrunPipeline(intent: CommandIntent): PipelineOutcome {
	const checks_passed: string[] = [];
	const checks_failed: string[] = [];

	if (!intent.addon_id?.trim()) {
		checks_failed.push("addon_id");
		return fail("invalid_command", "missing addon_id", checks_passed, checks_failed);
	}
	checks_passed.push("addon_id");

	if (!intent.command?.trim()) {
		checks_failed.push("command");
		return fail("invalid_command", "missing command", checks_passed, checks_failed);
	}
	checks_passed.push("command");

	// v0.0.1: always dryrun — execution_enabled / live / mapping not implemented yet
	checks_passed.push("dryrun_only");

	return {
		result: "dryrun_only",
		reason: "v0.0.1_no_device_writes",
		checks_passed,
		checks_failed,
	};
}

function fail(
	result: PipelineOutcome["result"],
	reason: string,
	checks_passed: string[],
	checks_failed: string[],
): PipelineOutcome {
	return { result, reason, checks_passed, checks_failed };
}

export function parseInbox(raw: string): CommandIntent | null {
	try {
		const data = JSON.parse(raw) as CommandIntent;
		if (typeof data !== "object" || data === null) return null;
		return data;
	} catch {
		return null;
	}
}
