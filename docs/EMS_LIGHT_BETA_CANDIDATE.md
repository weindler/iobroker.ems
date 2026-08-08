# EMS-Light Beta Candidate

**Vorgeschlagene Version:** `0.1.249`  
**Kennzeichnung:** Beta Candidate (kein stable/`latest`)  
**Basis:** Unified Day Planner als alleinige Allocation-Authority

## Was die Beta kann

- Gemeinsamer Day Planner für Batterie, Heizstab, Klima, Wallbox/EVCC
- PV-/Preis-/Hauslast-Forecast inkl. Learning-Inputs
- Material Replanning, Presence Learning, Day Evaluation
- Deterministische Produkt-Zusammenfassung + Notification Candidates (ohne Push)
- AI Advisory / Explanation (keine Plan-Authority)
- Vehicle Economics inkl. `earliest_feasible` wo vollständig bewertbar
- Dryrun als Default bei Neuinstallation und Restore

## Bewusste Grenzen

- Battery Discharge LIVE unsupported
- Future Presence anfangs geringe Learning-Confidence
- Export-Economics nur bei bekanntem Tarif vollständig
- AI mutiert keine Allocations (`AI_ALLOCATION_LIVE_MUTATION_ENABLED = false`)
- Kein vollständiger Multi-Day-Optimizer (Deadline darf über Mitternacht reichen)
- Keine neuen Push-Provider / GPS / neue Kalenderplattform

## Produktoberfläche (normal)

| Bereich | Fokus |
|--------|--------|
| Global | Strategie, Dryrun/Live, Status, Summary, Warnung |
| Batterie / IH / Klima / Wallbox | Aktiv, Telemetrie, Aktion, Ziel, Fehler |
| Advanced | Learning, KI, Compare, Policy |
| Deprecated/Internal | Shadow, Takeover, Lease, Gate-Internals — nicht Alltag |

## Ausführungsregel

Global `dryrun` → keine Gerätewrites.  
Global `live` → Write nur wenn Add-on ebenfalls `live`, Safety ok, Capability erlaubt.

## Release-Empfehlung

Siehe Abschlussbericht Schritt 8 — erwartet: **GO WITH KNOWN LIMITS**.
