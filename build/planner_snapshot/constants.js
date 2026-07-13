"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INPUT_REVISION_EXCLUDED_KEYS = exports.PLANNER_INPUT_SCHEMA_VERSION = exports.PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES = void 0;
/** Maximum bytes for planner input.json on disk. */
exports.PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES = 200 * 1024;
exports.PLANNER_INPUT_SCHEMA_VERSION = 2;
/** Fields excluded from semantic inputRevision hashing. */
exports.INPUT_REVISION_EXCLUDED_KEYS = ["capturedAt", "inputRevision", "sourceRevision"];
