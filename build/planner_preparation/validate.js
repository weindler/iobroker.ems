"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writePreparedInput = exports.readAndValidatePlannerInputFile = exports.validatePlannerInputBudget = exports.validatePlannerInputRevision = exports.parsePlannerInputSnapshotV2 = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const paths_1 = require("../backup_integration/paths");
const atomic_write_1 = require("../persistence/atomic_write");
const canonical_1 = require("../planner_snapshot/canonical");
const constants_1 = require("../planner_snapshot/constants");
const validate_1 = require("../planner_snapshot/validate");
const canonical_2 = require("./canonical");
const constants_2 = require("./constants");
const types_1 = require("./types");
function parsePlannerInputSnapshotV2(raw) {
    if (!(0, validate_1.validatePlannerInputSnapshotV2)(raw)) {
        throw new types_1.PlannerInputValidationError("invalid_schema", "input snapshot schema v2 validation failed");
    }
    const snapshot = raw;
    (0, validate_1.assertSnapshotSerializable)(snapshot);
    (0, validate_1.assertNoForbiddenSnapshotContent)(snapshot);
    return snapshot;
}
exports.parsePlannerInputSnapshotV2 = parsePlannerInputSnapshotV2;
function validatePlannerInputRevision(snapshot) {
    const expected = (0, canonical_1.computeInputRevision)({ ...snapshot, inputRevision: "" });
    if (snapshot.inputRevision !== expected) {
        throw new types_1.PlannerInputValidationError("input_revision_mismatch", `inputRevision mismatch: expected ${expected.slice(0, 12)}…`);
    }
}
exports.validatePlannerInputRevision = validatePlannerInputRevision;
function validatePlannerInputBudget(json) {
    const bytes = (0, canonical_1.utf8ByteLength)(json);
    if (bytes > constants_1.PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES) {
        throw new types_1.PlannerInputValidationError("input_budget_exceeded", `input snapshot exceeds budget: ${bytes} > ${constants_1.PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES}`);
    }
}
exports.validatePlannerInputBudget = validatePlannerInputBudget;
async function readAndValidatePlannerInputFile(inputPath) {
    let raw;
    try {
        raw = await fs.readFile(inputPath, "utf8");
    }
    catch (e) {
        throw new types_1.PlannerInputValidationError("input_missing", `input.json missing: ${String(e)}`);
    }
    validatePlannerInputBudget(raw);
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new types_1.PlannerInputValidationError("input_invalid_json", "input.json is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new types_1.PlannerInputValidationError("invalid_schema", "input must be an object");
    }
    const obj = parsed;
    if (obj.schemaVersion !== constants_1.PLANNER_INPUT_SCHEMA_VERSION) {
        throw new types_1.PlannerInputValidationError("invalid_schema_version", `unsupported input schemaVersion: ${String(obj.schemaVersion)}`);
    }
    const snapshot = parsePlannerInputSnapshotV2(parsed);
    validatePlannerInputRevision(snapshot);
    return snapshot;
}
exports.readAndValidatePlannerInputFile = readAndValidatePlannerInputFile;
async function writePreparedInput(jobDir, prepared, options) {
    const resolvedJob = path.resolve(jobDir);
    const resolvedRuntime = path.resolve(options.runtimeRootDir);
    (0, paths_1.assertPathWithinRoot)(resolvedJob, resolvedRuntime);
    const withRevision = {
        ...prepared,
        preparationRevision: (0, canonical_2.computePreparationRevision)({ ...prepared, preparationRevision: "" }),
    };
    const json = `${JSON.stringify(withRevision, null, 2)}\n`;
    const byteSize = (0, canonical_1.utf8ByteLength)(json);
    if (byteSize > constants_2.PLANNER_PREPARED_INPUT_BUDGET_BYTES) {
        throw new types_1.PlannerPreparedInputBudgetError(byteSize, constants_2.PLANNER_PREPARED_INPUT_BUDGET_BYTES);
    }
    if (withRevision.schemaVersion !== constants_2.PLANNER_PREPARED_INPUT_SCHEMA_VERSION) {
        throw new types_1.PlannerInputValidationError("invalid_prepared_schema", "prepared input schema invalid");
    }
    const target = path.join(resolvedJob, constants_2.PLANNER_PREPARED_INPUT_FILE);
    await (0, atomic_write_1.atomicWriteFile)(target, json, {
        validate: () => {
            const reread = JSON.parse(json);
            if (reread.inputRevision !== withRevision.inputRevision) {
                throw new Error("prepared inputRevision mismatch after write");
            }
        },
    });
    const { createHash } = await Promise.resolve().then(() => __importStar(require("node:crypto")));
    const sha256 = createHash("sha256").update(json).digest("hex");
    return {
        path: target,
        byteSize,
        sha256,
        preparationRevision: withRevision.preparationRevision,
    };
}
exports.writePreparedInput = writePreparedInput;
