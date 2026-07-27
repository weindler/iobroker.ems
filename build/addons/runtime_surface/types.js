"use strict";
/**
 * Unified addon runtime surface (Masterplan §10 / Roadmap Block 7).
 * Canonical fields under `addons.<runtimeId>.runtime.surface.*`.
 * Detailed per-addon `decision_source` leaves stay as decision_detail input — not overwritten.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANONICAL_DECISION_SOURCES = void 0;
exports.CANONICAL_DECISION_SOURCES = [
    "off",
    "manual",
    "policy",
    "deterministic_planner",
    "ai",
    "policy_fallback",
    "safety",
];
