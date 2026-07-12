"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRestoreRuntimeCleanup = void 0;
const diagnostic_mode_1 = require("../support/diagnostic_mode");
/** Neutralisiert bekannte Runtime-States nach Restore — keine Objekte löschen. */
async function runRestoreRuntimeCleanup(host) {
    (0, diagnostic_mode_1.stopDiagnosticMode)();
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
        }
        catch {
            // optional
        }
    }
}
exports.runRestoreRuntimeCleanup = runRestoreRuntimeCleanup;
