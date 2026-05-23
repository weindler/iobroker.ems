"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseInbox = exports.runDryrunPipeline = void 0;
/**
 * v0.0.1: dryrun-only pipeline — no device writes.
 * Full chain: see EMS docs mapping_concept.md §5 (later versions).
 */
function runDryrunPipeline(intent) {
    const checks_passed = [];
    const checks_failed = [];
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
exports.runDryrunPipeline = runDryrunPipeline;
function fail(result, reason, checks_passed, checks_failed) {
    return { result, reason, checks_passed, checks_failed };
}
function parseInbox(raw) {
    try {
        const data = JSON.parse(raw);
        if (typeof data !== "object" || data === null)
            return null;
        return data;
    }
    catch {
        return null;
    }
}
exports.parseInbox = parseInbox;
