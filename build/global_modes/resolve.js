"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGlobalModes = exports.validateRequestedMode = void 0;
const node_crypto_1 = require("node:crypto");
const normalize_1 = require("../policy/core/normalize");
const hash_1 = require("../policy/core/hash");
const constants_1 = require("./constants");
const schema_1 = require("./schema");
const config_1 = require("./config");
function validateRequestedMode(raw) {
    if (raw === null || raw === undefined || raw === "") {
        return { mode: null, issue: null };
    }
    const s = String(raw).trim().toLowerCase();
    if (!s) {
        return { mode: null, issue: null };
    }
    if ((0, config_1.isGlobalMode)(s)) {
        return { mode: s, issue: null };
    }
    return {
        mode: null,
        issue: {
            code: "global_mode_invalid",
            severity: "error",
            path: "global_modes.requested",
            message: `Ungültiger Global Mode: ${s}`,
        },
    };
}
exports.validateRequestedMode = validateRequestedMode;
function resolveGlobalModes(input) {
    const issues = [];
    const validated = validateRequestedMode(input.requestedRaw);
    let requested;
    let active;
    let valid = true;
    let status = "ready";
    if (validated.mode !== null) {
        requested = validated.mode;
        active = validated.mode;
    }
    else if (validated.issue) {
        requested = constants_1.DEFAULT_GLOBAL_MODE;
        active = constants_1.DEFAULT_GLOBAL_MODE;
        valid = false;
        status = "fallback";
        issues.push(validated.issue);
        issues.push({
            code: "global_mode_fallback",
            severity: "warning",
            path: "global_modes.active",
            message: `Fallback auf ${constants_1.DEFAULT_GLOBAL_MODE} wegen ungültigem requested: ${String(input.requestedRaw)}`,
        });
    }
    else {
        requested = input.adminDefault;
        active = input.adminDefault;
    }
    const profile = (0, schema_1.profileForMode)(active);
    const sortedIssues = (0, normalize_1.sortIssuesDeterministic)(issues);
    const revisionPayload = {
        requested,
        active,
        valid,
        status,
        profile,
        issues: sortedIssues,
    };
    const hash = (0, node_crypto_1.createHash)("sha256").update((0, hash_1.stableStringify)(revisionPayload), "utf8").digest("hex");
    return {
        requested,
        active,
        valid,
        status,
        issues: sortedIssues,
        profile,
        revision: hash.slice(0, 16),
    };
}
exports.resolveGlobalModes = resolveGlobalModes;
