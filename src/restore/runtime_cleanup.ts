import { stopDiagnosticMode } from "../support/diagnostic_mode";
import type { RestoreHost } from "./types";

/** Neutralisiert bekannte Runtime-States nach Restore — keine Objekte löschen. */
export async function runRestoreRuntimeCleanup(host: RestoreHost): Promise<void> {
	stopDiagnosticMode();
	await host.setStateAsync("command.inbox", { val: "", ack: true });
	await host.setStateAsync("backup.export_request", { val: false, ack: true });
	await host.setStateAsync("backup.support_export_request", { val: false, ack: true });
	await host.setStateAsync("support.diagnostic_request", { val: false, ack: true });
	await host.setStateAsync("support.diagnostic_mode", { val: false, ack: true });
	await host.setStateAsync("support.diagnostic_expires_at", { val: "", ack: true });
	await host.setStateAsync("backup.restore.validate_request", { val: false, ack: true });
	await host.setStateAsync("backup.restore.apply_request", { val: false, ack: true });

	const neutralStates = [
		"addons.wallbox.feedback.pending",
		"addons.battery.status.ownership",
		"planner.wallbox.daily_plan.dispatch",
	];
	for (const id of neutralStates) {
		try {
			const st = await host.getStateAsync(id);
			if (st) {
				await host.setStateAsync(id, { val: null, ack: true });
			}
		} catch {
			// optional
		}
	}
}
