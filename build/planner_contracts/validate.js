"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePlannerWorkerResult = exports.validatePlannerInputSnapshot = exports.validatePlannerJobRequest = exports.assertWithinIpcBudget = exports.utf8ByteLength = void 0;
const constants_1 = require("./constants");
function isObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v) {
    return typeof v === "string" && v.trim() !== "";
}
function isIsoString(v) {
    return typeof v === "string" && !Number.isNaN(Date.parse(v));
}
function utf8ByteLength(text) {
    return Buffer.byteLength(text, "utf8");
}
exports.utf8ByteLength = utf8ByteLength;
function assertWithinIpcBudget(text, label) {
    if (utf8ByteLength(text) > constants_1.PLANNER_IPC_BUDGET_BYTES) {
        throw new Error(`${label} exceeds IPC budget (${constants_1.PLANNER_IPC_BUDGET_BYTES} bytes)`);
    }
}
exports.assertWithinIpcBudget = assertWithinIpcBudget;
function validatePlannerJobRequest(raw) {
    const errors = [];
    if (!isObject(raw)) {
        return { valid: false, errors: ["request must be an object"] };
    }
    if (raw.schemaVersion !== constants_1.PLANNER_SCHEMA_VERSION)
        errors.push("invalid schemaVersion");
    if (!isNonEmptyString(raw.jobId))
        errors.push("jobId required");
    if (typeof raw.generation !== "number" || !Number.isFinite(raw.generation) || raw.generation < 0) {
        errors.push("generation must be a non-negative number");
    }
    if (!constants_1.PLANNER_JOB_TRIGGERS.includes(raw.trigger))
        errors.push("invalid trigger");
    if (!constants_1.PLANNER_JOB_MODES.includes(raw.mode))
        errors.push("invalid mode");
    if (!constants_1.PLANNER_JOB_KINDS.includes(raw.kind))
        errors.push("invalid kind");
    if (!isIsoString(raw.requestedAt))
        errors.push("requestedAt must be ISO timestamp");
    if (typeof raw.timeoutMs !== "number" || raw.timeoutMs <= 0)
        errors.push("timeoutMs must be positive");
    if (!isNonEmptyString(raw.inputSnapshotPath))
        errors.push("inputSnapshotPath required");
    if (errors.length)
        return { valid: false, errors };
    return {
        valid: true,
        errors: [],
        value: raw,
    };
}
exports.validatePlannerJobRequest = validatePlannerJobRequest;
function validatePlannerInputSnapshot(raw) {
    const errors = [];
    if (!isObject(raw))
        return { valid: false, errors: ["input must be an object"] };
    if (raw.schemaVersion !== constants_1.PLANNER_SCHEMA_VERSION)
        errors.push("invalid schemaVersion");
    if (!isIsoString(raw.capturedAt))
        errors.push("capturedAt must be ISO timestamp");
    if (!isNonEmptyString(raw.timezone))
        errors.push("timezone required");
    if (!isNonEmptyString(raw.globalMode))
        errors.push("globalMode required");
    if (raw.context !== undefined && !isObject(raw.context))
        errors.push("context must be an object");
    if (errors.length)
        return { valid: false, errors };
    return { valid: true, errors: [], value: raw };
}
exports.validatePlannerInputSnapshot = validatePlannerInputSnapshot;
function validateFileDescriptor(raw, errors, index) {
    if (!isObject(raw)) {
        errors.push(`files[${index}] must be an object`);
        return null;
    }
    if (!isNonEmptyString(raw.fileName))
        errors.push(`files[${index}].fileName required`);
    if (typeof raw.byteSize !== "number" || raw.byteSize < 0)
        errors.push(`files[${index}].byteSize invalid`);
    if (!isNonEmptyString(raw.sha256) || !/^[a-f0-9]{64}$/.test(raw.sha256)) {
        errors.push(`files[${index}].sha256 must be 64-char hex`);
    }
    if (errors.length)
        return null;
    return raw;
}
function validateCompactSummary(raw, errors) {
    if (!isObject(raw)) {
        errors.push("summary must be an object");
        return null;
    }
    const forecast = raw.forecast;
    const daily = raw.daily;
    const quality = raw.quality;
    if (!isObject(forecast) || !isObject(daily) || !isObject(quality)) {
        errors.push("summary.forecast/daily/quality required");
        return null;
    }
    return raw;
}
function validateAllocation(raw, errors, index) {
    if (!isObject(raw)) {
        errors.push(`allocations[${index}] must be an object`);
        return null;
    }
    if (!isNonEmptyString(raw.addonId))
        errors.push(`allocations[${index}].addonId required`);
    if (!isNonEmptyString(raw.status))
        errors.push(`allocations[${index}].status required`);
    if (typeof raw.revision !== "number")
        errors.push(`allocations[${index}].revision invalid`);
    if (typeof raw.reasonDe !== "string")
        errors.push(`allocations[${index}].reasonDe required`);
    if (typeof raw.payloadJson !== "string")
        errors.push(`allocations[${index}].payloadJson required`);
    if (errors.length)
        return null;
    return raw;
}
function validatePlannerWorkerResult(raw) {
    const errors = [];
    if (!isObject(raw))
        return { valid: false, errors: ["result must be an object"] };
    if (raw.schemaVersion !== constants_1.PLANNER_SCHEMA_VERSION)
        errors.push("invalid schemaVersion");
    if (!isNonEmptyString(raw.jobId))
        errors.push("jobId required");
    if (typeof raw.generation !== "number" || !Number.isFinite(raw.generation))
        errors.push("generation invalid");
    if (!constants_1.PLANNER_WORKER_STATUSES.includes(raw.status))
        errors.push("invalid status");
    if (!isNonEmptyString(raw.semanticRevision))
        errors.push("semanticRevision required");
    const summary = validateCompactSummary(raw.summary, errors);
    if (!Array.isArray(raw.files))
        errors.push("files must be an array");
    const files = [];
    if (Array.isArray(raw.files)) {
        for (let i = 0; i < raw.files.length; i++) {
            const fd = validateFileDescriptor(raw.files[i], errors, i);
            if (fd)
                files.push(fd);
        }
    }
    const allocations = [];
    if (!Array.isArray(raw.allocations)) {
        errors.push("allocations must be an array");
    }
    else {
        for (let i = 0; i < raw.allocations.length; i++) {
            const a = validateAllocation(raw.allocations[i], errors, i);
            if (a)
                allocations.push(a);
        }
    }
    if (raw.error !== undefined) {
        if (!isObject(raw.error) || !isNonEmptyString(raw.error.code) || typeof raw.error.messageDe !== "string") {
            errors.push("error must have code and messageDe");
        }
    }
    if (errors.length || !summary)
        return { valid: false, errors };
    const value = {
        ...raw,
        summary,
        files,
        allocations,
    };
    try {
        assertWithinIpcBudget(JSON.stringify(value), "result");
    }
    catch (e) {
        errors.push(String(e));
    }
    if (errors.length)
        return { valid: false, errors };
    return { valid: true, errors: [], value };
}
exports.validatePlannerWorkerResult = validatePlannerWorkerResult;
