"use strict";
/**
 * PHASE 4 — KI Daily Analyst.
 *
 * Die KI ist hier ausschließlich Analyst, nie Regler: sie liest eine kompakte, strukturierte
 * Tageszusammenfassung (Daily-Evaluator-Findings/Scores, keine Rohtelemetrie) und liefert
 * strukturierte Findings zurück. Kein Schaltbefehl, kein Config-Write, kein Planner-Write.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_ANALYST_ALLOWED_DIRECTIONS = exports.AI_ANALYST_ALLOWED_SEVERITIES = exports.AI_ANALYST_ALLOWED_DOMAINS = void 0;
exports.AI_ANALYST_ALLOWED_DOMAINS = [
    "pv_forecast",
    "battery",
    "thermal",
    "climate",
    "ev",
    "grid",
    "price_timing",
    "general",
];
exports.AI_ANALYST_ALLOWED_SEVERITIES = ["info", "notice", "warning"];
exports.AI_ANALYST_ALLOWED_DIRECTIONS = [
    "cost_down",
    "comfort_up",
    "reserve_safety_up",
    "unclear",
];
