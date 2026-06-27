"use strict";
/** Policy Engine Foundation — Phase 3A */
Object.defineProperty(exports, "__esModule", { value: true });
exports.POLICY_ISSUE_SEVERITY_ORDER = exports.CONFIDENCE_MAX = exports.CONFIDENCE_MIN = exports.LEARNING_HARD_LIMIT_MIN_CONFIDENCE = exports.POLICY_ENGINE_VERSION = exports.POLICY_SCHEMA_VERSION = void 0;
exports.POLICY_SCHEMA_VERSION = "policy_v1";
exports.POLICY_ENGINE_VERSION = "0.1.49";
/** Learning darf erst ab dieser Confidence ein hartes technisches Limit setzen. */
exports.LEARNING_HARD_LIMIT_MIN_CONFIDENCE = 0.6;
exports.CONFIDENCE_MIN = 0;
exports.CONFIDENCE_MAX = 1;
exports.POLICY_ISSUE_SEVERITY_ORDER = ["error", "warning", "info"];
