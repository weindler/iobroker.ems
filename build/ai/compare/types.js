"use strict";
/**
 * Plan-Vergleich (Plan A = deterministisch, Plan B = KI-gewichtete Simulation).
 *
 * WICHTIG — Sicherheitsrahmen:
 * Plan B ist AUSSCHLIESSLICH eine Beobachtungs-/Statistik-Simulation für den Vergleich.
 * EMS führt zu jedem Zeitpunkt weiterhin Plan A (den deterministischen Tagesplan) aus.
 * "active_plan" ist eine reine Anzeige-Information ("welcher Plan wäre rechnerisch günstiger") —
 * sie schaltet nichts um und schreibt nie auf Geräte. Eine echte Übernahme von Plan B wäre ein
 * separater, zukünftiger Schritt mit eigener Freigabe (siehe Masterplan §13).
 *
 * Plan B verschiebt außerdem nur den ZEITPUNKT der ohnehin von Plan A für Heizstab/Klima
 * vorgesehenen Energiemenge — es wird nie mehr oder weniger Energie eingeplant als Plan A.
 */
Object.defineProperty(exports, "__esModule", { value: true });
