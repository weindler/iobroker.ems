# EMS-Light Beta Candidate

**Quellstand:** `0.2.26`

**Kennzeichnung:** Beta Candidate (kein stable/`latest`)  
**Basis:** Unified Day Planner als alleinige Allocation-Authority

## Was die Beta kann

- Gemeinsamer Day Planner für Batterie, Heizstab, Klima, Wallbox/EVCC
- PV-/Preis-/Hauslast-Forecast inkl. Learning-Inputs
- Material Replanning, Presence Learning, Day Evaluation
- Deterministische Produkt-Zusammenfassung + Notification Candidates (ohne Push)
- Strukturierter, rollierender 72-h-Ausblick aus dem Unified Plan
- Energetische Bilanz mit Autarkie, Eigenverbrauch und Geräte-PV-Anteilen
- Katalog tatsächlich implementierter Geräteprofile und lokaler read-only App-Core-Snapshot
- AI Advisory / Explanation (keine Plan-Authority)
- Vehicle Economics inkl. `earliest_feasible` wo vollständig bewertbar
- Dryrun als Default bei Neuinstallation und Restore

## Bewusste Grenzen

- Allgemeiner aktiver Battery-Discharge-Dispatch LIVE unsupported; Sonnen Grid Balance bleibt der vorhandene eng gegatete Entladepfad
- Future Presence anfangs geringe Learning-Confidence
- Export-Economics nur bei bekanntem Tarif vollständig
- AI mutiert keine Allocations (`AI_ALLOCATION_LIVE_MUTATION_ENABLED = false`)
- Kein mathematisch global-optimaler Multi-Day-Solver; der Unified Planner nutzt den mehrtägigen Horizont und veröffentlicht eine rollierende 72-h-Sicht
- Keine neuen Push-Provider / GPS / neue Kalenderplattform

## Produktoberfläche (normal)

| Bereich | Fokus |
|--------|--------|
| Betrieb | aktuelle Lage, 72-h-Entscheidungen und Verschiebungen |
| Statistik | Energie, Kosten, Shadow-/EMS-Mehrwert und Mobilität |
| Batterie | Ist, Nacht-Learning, nächste Aktion und Begründung |
| Heizstab / Wärme | Boiler/Puffer, Hygiene, thermische Reichweite und Planung |
| Klima | je Gerät Ist, Shared-Power/Learning, nächste Aktion und Begründung |
| Auto / Wallbox | Verbindung, SOC/Laden, Planung und Begründung |
| Grid Balance | AUS/BLOCKIERT/BEREIT/AKTIV, Learning, Schutzgrund und Sollwert |

## Ausführungsregel

Global `dryrun` → keine Gerätewrites.  
Global `live` → Write nur wenn Add-on ebenfalls `live`, Safety ok, Capability erlaubt.

## Release-Empfehlung

Siehe Abschlussbericht Schritt 8 — erwartet: **GO WITH KNOWN LIMITS**.
