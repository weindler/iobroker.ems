"use strict";
/**
 * BLOCK B — gemeinsame, kleine Explainability-Struktur für Learned-Planner-Entscheidungen.
 *
 * Bewusst klein (keine große Explainability-Architektur): EIN generischer Rahmen, den jede
 * Block-B-Domain (Thermal, Battery, ...) mit ihrem eigenen `TDecision`-Typ befüllt. Rein
 * diagnostisch — dieser Typ selbst trifft und beeinflusst NIE eine Control-Entscheidung,
 * er beschreibt nur eine bereits getroffene.
 */
Object.defineProperty(exports, "__esModule", { value: true });
