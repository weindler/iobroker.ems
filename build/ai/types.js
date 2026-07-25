"use strict";
/**
 * KI-Optimierungsschicht — Verträge.
 *
 * Rahmen (siehe docs/EMS_LIGHT_MASTERPLAN.md Abschnitt 4/8/13):
 * - Die KI optimiert ausschließlich innerhalb bestehender Policy-/Safety-/Add-on-Grenzen.
 * - Sie schreibt niemals direkt auf Geräte-States, ändert niemals Policies und
 *   plant niemals ein Add-on ohne dessen individuelle "KI-Optimierung erlaubt"-Freigabe.
 * - Bei Fehler/Timeout/ungültiger Antwort bleibt der deterministische Plan unverändert
 *   in Kraft (fail-closed).
 */
Object.defineProperty(exports, "__esModule", { value: true });
