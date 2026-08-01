"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planSummaryJson = exports.assertPlanMatchesIdentity = exports.markPlanUsed = exports.createRestorePlan = exports.invalidateRestorePlan = exports.getActiveRestorePlan = exports.clearRestorePlanForTest = void 0;
const node_crypto_1 = require("node:crypto");
const types_1 = require("./types");
const learning_map_1 = require("./learning_map");
const RESTORE_LEARNING_KEY_COUNT = learning_map_1.RESTORE_LEARNING_KEYS.length;
let activePlan = null;
function clearRestorePlanForTest() {
    activePlan = null;
}
exports.clearRestorePlanForTest = clearRestorePlanForTest;
function getActiveRestorePlan() {
    if (!activePlan)
        return null;
    if (activePlan.used || Date.now() > Date.parse(activePlan.expiresAt)) {
        activePlan = null;
        return null;
    }
    return activePlan;
}
exports.getActiveRestorePlan = getActiveRestorePlan;
function invalidateRestorePlan() {
    activePlan = null;
}
exports.invalidateRestorePlan = invalidateRestorePlan;
function createRestorePlan(input) {
    const now = Date.now();
    const planId = (0, node_crypto_1.randomUUID)();
    const vehicleProfileCount = Array.isArray(input.projection.native.wb_vehicle_map)
        ? input.projection.native.wb_vehicle_map.length
        : 0;
    const learningFileCount = Object.keys(input.projection.learning).length;
    const learningFilesToRemove = RESTORE_LEARNING_KEY_COUNT - learningFileCount;
    const summary = {
        fileName: input.identity.fileName,
        backupVersion: input.manifest.adapter.version,
        schemaVersion: input.manifest.schema_version,
        exportAt: input.manifest.created_at,
        changedConfigFields: input.changedConfigFields,
        vehicleProfileCount,
        learningFileCount,
        learningFilesToRemove,
        skippedClasses: input.projection.skippedClasses,
        warnings: input.projection.warnings,
        configuredModesAtExport: { ...input.projection.configuredModesAtExport },
        applyModes: {
            global: "dryrun",
            wallbox: "dryrun",
            battery: "dryrun",
            immersion_heater: "dryrun",
            air_conditioning: "dryrun",
        },
    };
    const plan = {
        planId,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + types_1.RESTORE_PLAN_TTL_MS).toISOString(),
        used: false,
        identity: input.identity,
        manifest: input.manifest,
        projection: input.projection,
        summary,
    };
    activePlan = plan;
    return plan;
}
exports.createRestorePlan = createRestorePlan;
function markPlanUsed() {
    if (activePlan)
        activePlan.used = true;
}
exports.markPlanUsed = markPlanUsed;
function assertPlanMatchesIdentity(identity, confirmPlanId) {
    const plan = getActiveRestorePlan();
    if (!plan) {
        throw new Error("no valid restore plan");
    }
    if (plan.planId !== confirmPlanId) {
        throw new Error("invalid plan id");
    }
    if (plan.identity.fileName !== identity.fileName) {
        throw new Error("archive file name changed");
    }
    if (plan.identity.archiveSha256 !== identity.archiveSha256) {
        throw new Error("archive content changed");
    }
    if (plan.identity.sizeBytes !== identity.sizeBytes) {
        throw new Error("archive size changed");
    }
    if (plan.identity.mtimeMs !== identity.mtimeMs) {
        throw new Error("archive mtime changed");
    }
    return plan;
}
exports.assertPlanMatchesIdentity = assertPlanMatchesIdentity;
function planSummaryJson(plan) {
    return JSON.stringify(plan.summary);
}
exports.planSummaryJson = planSummaryJson;
