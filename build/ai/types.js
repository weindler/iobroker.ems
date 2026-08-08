"use strict";
/**
 * KI-Optimierungsschicht — Verträge.
 *
 * Rahmen (siehe docs/EMS_LIGHT_MASTERPLAN.md Abschnitt 4/8/13):
 * - Die KI optimiert ausschließlich innerhalb bestehender Policy-/Safety-/Add-on-Grenzen.
 * - Sie schreibt niemals direkt auf Geräte-States, ändert niemals Policies und
 *   plant niemals ein Add-on ohne dessen individuelle "KI-Optimierung erlaubt"-Freigabe.
 * - Beta: Plan B / Slot-Prefs sind advisory. AI mutiert keine Live-Allocations;
 *   Unified Planner ist alleinige Planwahrheit. Learning → Input → Unified bleibt erlaubt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
