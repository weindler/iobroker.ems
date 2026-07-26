"use strict";
/**
 * KI-Optimierungsschicht — Verträge.
 *
 * Rahmen (siehe docs/EMS_LIGHT_MASTERPLAN.md Abschnitt 4/8/13):
 * - Die KI optimiert ausschließlich innerhalb bestehender Policy-/Safety-/Add-on-Grenzen.
 * - Sie schreibt niemals direkt auf Geräte-States, ändert niemals Policies und
 *   plant niemals ein Add-on ohne dessen individuelle "KI-Optimierung erlaubt"-Freigabe.
 * - Write-back (Block 6) geht nur über Daily-Plan-Allocation, und nur wenn Plan B Plan A
 *   messbar schlägt — sonst Auto-KI aus (fail-closed).
 */
Object.defineProperty(exports, "__esModule", { value: true });
