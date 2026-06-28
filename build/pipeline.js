"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommandPipeline = void 0;
const governance_1 = require("./addons/governance");
const registry_1 = require("./addons/registry");
const execution_mode_1 = require("./execution_mode");
const mapping_1 = require("./mapping");
/**
 * Canonical pipeline — dryrun mirror always; live write wenn global.live ∧ addon.live.
 */
async function runCommandPipeline(intent, ctx) {
    const checks_passed = [];
    const checks_failed = [];
    const addonId = intent.addon_id?.trim() ?? "";
    const command = intent.command?.trim() ?? "";
    const mappingId = command;
    if (!addonId) {
        checks_failed.push("addon_id");
        return fail("invalid_command", "missing_addon_id", checks_passed, checks_failed);
    }
    checks_passed.push("addon_id");
    if (!command) {
        checks_failed.push("command");
        return fail("invalid_command", "missing_command", checks_passed, checks_failed);
    }
    checks_passed.push("command");
    if ((0, registry_1.isReadOnlyAddon)(addonId)) {
        checks_failed.push("read_only_addon");
        return fail("blocked", "read_only_addon", checks_passed, checks_failed, { addon_mode: "read_only" });
    }
    const available = await ctx.getState(`addons.${addonId}.available`);
    if (available?.val === false) {
        checks_failed.push("addon_not_available");
        return fail("blocked", "addon_not_available", checks_passed, checks_failed);
    }
    checks_passed.push("addon_available");
    const enabled = await ctx.getState(`addons.${addonId}.enabled`);
    if (enabled?.val === false) {
        checks_failed.push("addon_disabled");
        return fail("blocked", "addon_disabled", checks_passed, checks_failed);
    }
    checks_passed.push("addon_enabled");
    const governanceEnabled = await (0, governance_1.isAddonGovernanceEnabledFromState)(ctx.getState, addonId);
    if (!governanceEnabled) {
        checks_failed.push("addon_governance_disabled");
        return fail("blocked", "addon_governance_disabled", checks_passed, checks_failed);
    }
    checks_passed.push("addon_governance_enabled");
    const modeRaw = await ctx.getState(`addons.${addonId}.mode`);
    const mode = String(modeRaw?.val ?? "dryrun").toLowerCase();
    if (mode === "disabled") {
        checks_failed.push("addon_mode_disabled");
        return fail("blocked", "addon_mode_disabled", checks_passed, checks_failed, { addon_mode: mode });
    }
    checks_passed.push(`addon_mode_${mode}`);
    const requiredCap = (0, registry_1.commandNeedsCapability)(addonId, command);
    if (requiredCap) {
        if (!(0, registry_1.addonHasCapability)(addonId, requiredCap)) {
            checks_failed.push("capability_missing");
            return fail("capability_missing", requiredCap, checks_passed, checks_failed);
        }
        checks_passed.push(`capability_${requiredCap}`);
    }
    const mapping = await (0, mapping_1.loadMapping)(ctx, addonId, mappingId);
    if (!mapping) {
        checks_failed.push("mapping_missing");
        return fail("mapping_missing", mappingId, checks_passed, checks_failed, { addon_mode: mode });
    }
    checks_passed.push("mapping_present");
    if (!mapping.enabled) {
        checks_failed.push("mapping_disabled");
        return fail("blocked", "mapping_disabled", checks_passed, checks_failed, {
            mapping_id: mappingId,
            target_state: mapping.targetState,
        });
    }
    checks_passed.push("mapping_enabled");
    if (!mapping.targetState) {
        checks_failed.push("target_missing");
        return fail("target_missing", mappingId, checks_passed, checks_failed);
    }
    checks_passed.push("target_state_set");
    const plannedValue = (0, mapping_1.resolvePlannedValue)(command, intent.value, mapping.targetState);
    if (!(0, mapping_1.isValueAllowed)(intent.value, mapping.allowedValues)) {
        checks_failed.push("value_not_allowed");
        return fail("value_not_allowed", String(intent.value), checks_passed, checks_failed, {
            mapping_id: mappingId,
            target_state: mapping.targetState,
            planned_value: plannedValue,
        });
    }
    checks_passed.push("value_allowed");
    checks_passed.push("safety_ok");
    const liveAllowed = (await ctx.isLiveAllowed?.(addonId)) ?? (await (0, execution_mode_1.isLiveWriteAllowed)(ctx.getState, addonId));
    if (mode === "live" && liveAllowed && ctx.setForeignState) {
        const writeGovernanceOk = await (0, governance_1.isAddonGovernanceEnabledFromState)(ctx.getState, addonId);
        if (!writeGovernanceOk) {
            checks_failed.push("addon_governance_disabled");
            return fail("blocked", "addon_governance_disabled", checks_passed, checks_failed);
        }
        const writeVal = scalarForForeignWrite(command, plannedValue, intent.value);
        try {
            await ctx.setForeignState(mapping.targetState, writeVal);
            checks_passed.push("live_write_ok");
            return {
                result: "success",
                reason: "live_write",
                checks_passed,
                checks_failed,
                mapping_id: mappingId,
                target_state: mapping.targetState,
                planned_value: plannedValue,
                addon_mode: mode,
            };
        }
        catch {
            checks_failed.push("live_write_failed");
            return fail("blocked", "live_write_failed", checks_passed, checks_failed, {
                mapping_id: mappingId,
                target_state: mapping.targetState,
                planned_value: plannedValue,
                addon_mode: mode,
            });
        }
    }
    if (mode === "live" && !liveAllowed) {
        checks_passed.push("live_blocked_global_or_addon");
    }
    return {
        result: "dryrun_only",
        reason: mode === "live" && !liveAllowed ? "live_blocked_global_or_addon" : "dryrun_no_device_write",
        checks_passed,
        checks_failed,
        mapping_id: mappingId,
        target_state: mapping.targetState,
        planned_value: plannedValue,
        addon_mode: mode,
    };
}
exports.runCommandPipeline = runCommandPipeline;
function scalarForForeignWrite(command, plannedValue, requestValue) {
    if (command === "set_charge_power_w") {
        if (typeof plannedValue === "object" && plannedValue !== null) {
            const ampere = plannedValue.ampere;
            if (typeof ampere === "number" && Number.isFinite(ampere)) {
                return ampere;
            }
        }
    }
    if (command === "set_enabled") {
        if (typeof requestValue === "boolean") {
            return requestValue;
        }
        if (requestValue === 1 || requestValue === "1" || requestValue === "true") {
            return true;
        }
        if (requestValue === 0 || requestValue === "0" || requestValue === "false") {
            return false;
        }
    }
    return (plannedValue ?? requestValue);
}
function fail(result, reason, checks_passed, checks_failed, extra = {}) {
    return { result, reason, checks_passed, checks_failed, ...extra };
}
