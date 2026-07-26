"use strict";
/**
 * Plan-Vergleich (Plan A = deterministisch, Plan B = KI-gewichtete Simulation).
 *
 * Roadmap Block 6: Wenn Plan B messbar gewinnt (Kosten/PV/Netz), schreibt `src/ai/writeback/`
 * die umverteilte Allocation in den Daily Plan (nie direkt auf Geräte). Sonst bleibt Plan A
 * und Auto-KI wird gesperrt. Plan B verschiebt nur den Zeitpunkt der von Plan A vorgesehenen
 * flexiblen Energiemenge für Heizstab/Klima — nie mehr Gesamtenergie.
 */
Object.defineProperty(exports, "__esModule", { value: true });
