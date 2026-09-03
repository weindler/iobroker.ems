"use strict";
/**
 * Plan-Vergleich (Plan A = deterministisch, Plan B = KI-gewichtete Simulation).
 *
 * Beta (Schritt 7 Final Gate): Plan B ist advisory/comparison. Live-Authority ist ausschließlich
 * der Unified Planner. `src/ai/writeback/` schreibt Compare-States, mutiert aber keine
 * Allocations/Slices. Simulation darf weiterhin zeigen, wie flexible Energiemengen zeitlich
 * verschoben würden — nie Batterie-Entladen, nie Geräte-Writes. `defer_tomorrow` darf
 * flexible Heizstabenergie unverteilt lassen (nicht als erfüllt verbuchen).
 */
Object.defineProperty(exports, "__esModule", { value: true });
