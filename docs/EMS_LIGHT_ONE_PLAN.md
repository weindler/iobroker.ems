# EMS-Light — Ein Plan (Kanondokument)

**Stand:** 07.08.2026  
**Status:** Verbindliches Produkt- und Programmierziel für Agenten.  
**Alt-Docs:** `docs/_archive/` (technisch/historisch, nicht das Zielbild).

---

## Was schiefging (Ist)

Das System wirkte wie Einzel-Add-ons. Folge am Beispiel 04.08.2026:

- Tagsüber kräftig eingespeist (~0,093 €)
- Nachmittags hätte der Heizstab bei PV auf ~60 °C gekonnt
- Abends Wolken, Üss 0, Heizstab 1700 W + Klima, Batterie ~92 % — Energie aus Batterie/Netz bei ~35 ct

Das ist kein „Abend-Schalter fehlt“. Das ist **fehlende gemeinsame Vorplanung**.

---

## Soll — eine Intelligenz

Keine Sommer-/Winterlogik. Keine Heizstab-only-Fixerei.

**Gleichzeitig** in **einem** Tagesplan:

| Eingang | Bedeutung |
|--------|-----------|
| PV-Ertrag | Summe + Bias, Stunden, Start/Ende, Wetterentwicklung |
| Strompreise | **Ganzer Tag**, alle Fenster (Beispiel ≠ Scope) |
| Hauslast | Gelernt, Unsicherheit einrechnen |
| Batterie | Lade-/Reserve-Bedarf im selben Topf |
| Klima | Bedarf im selben Topf |
| Heizstab | Thermal „reicht bis …“ → vorplanen in gute Fenster |
| Wallbox | Bedarf + Preise/Fenster im selben Topf |

```text
PV × Preise × Hauslast
        × Batterie × Klima × Heizstab × Wallbox
        → ein Plan (~00:05 und bei Abweichung neu)
```

---

## Vorplanen

- Reicht der Puffer nicht bis zum nächsten sinnvollen PV-/Morgenfenster → **früher** bei PV hochheizen (nicht abends aus Batterie).
- Wetter kippt (Vormittag schlecht / Nachmittag schlecht) → Verbraucher **gemeinsam** verschieben.
- Morgen besser/schlechter/gleich → Zielhöhen und Reihenfolge im **selben** Plan.
- Teure Preise + wenig PV + niedriger SOC tun weh — dieselbe Logik, keine Jahreszeit-Schublade.

---

## KI

Deterministischer gemeinsamer Plan zuerst. KI nur optionale Optimierung **innerhalb** der Grenzen — nie Ersatz für PV×Preise×Last×alle Verbraucher.

---

## Umsetzung

### Schritt 1 — erledigt (Contract + Golden Tests)

Code: `src/operator/daily_plan/unified/`  
Gemeinsamer Input-/Output-Vertrag, Constraints/Objectives, Replan-Trigger, Golden Tests 001–005.

### Schritt 2 — Allocation + IH/AC Live-Authority

`allocateUnifiedDayPlan()` — deterministische gemeinsame Allocation (Phasen A–F), ALLOC-001…007.  
IH/AC: Unified wird vor dem Publish in `daily_plan.allocations` gemerged und ist autoritativ  
(`allocations_json` ≡ Addon-Slices). Battery/Wallbox bleiben klassisch. Bei Unified-Fehler: IH/AC idle.

### Schritt 3 — Real Data Bridge

`buildUnifiedInputFromForecastContext()` mappt den produktiven ForecastPlan-Snapshot  
(+ Contribution-Details, Live-Overrides) → `UnifiedDayPlannerInput`.  
PV: bereits bias-korrigierte Werte aus `learning.pv_bias` (keine Doppelkorrektur).  
Battery/EVCC: Planung/Simulation; IH/AC: Live. Future vehicle presence: unknown (kein Hardcode).

### Schritt 4 — Material Replanning + Plan-vs-Actual

`evaluateMaterialReplan()` (Cadence-Digest + kleine Schwellen) entscheidet, ob ein neuer Unified-Plan nötig ist.  
Anti-Chatter-Cooldown für weiche Abweichungen; harte Events (Tag, Vehicle, AC-Komfort) sofort.  
Replan: neue Generation, `previousExpectedDayEnergyKwh`, Rest-Horizont ab jetzt, Vergangenheit unverändert.  
Tagesbewertungs-Struktur für späteres Learning (noch ohne Persistenz).

### Schritt 5 — Future Vehicle Presence

Availability pro Fenster: `available` / `unavailable` / `unknown` mit Quelle live|explicit|predicted.  
Priorität live > explicit > predicted Learning > unknown. Keine erfundenen Anwesenheitszeiten.  
Allocator lädt nur in `available`-Slots; Zielerreichbarkeit mit hard/predicted/unknown getrennt.

### Schritt 6 — Unified Battery + EVCC Live Authority

Bei gültigem Unified Day Plan sind IH/AC/**Battery**/**Wallbox** autoritativ über dieselbe Generation  
(`daily_plan.allocations_json` ≡ Addon-`plan_json`). Dispatch nur über bestehende Runtimes  
(Sonnen EM charge/hold/grid_balance; EVCC `mode`/`maxCurrent`). Kein Discharge-Live, keine Planner-Gerätewrites.  
Fahrzeugziel inkl. SOC-Qualität/Deadline/Presence verdrahtet; `vehicleChargeEconomics` im Plan.  
Replan-Failure: sicherer Hold/idle je Slice; EVCC bleibt manuell nutzbar.

### Schritt 7 — Day Evaluation + Learning + AI Explanation + Notification Data

Persistierte Tagesbewertung (`learning/day_evaluation/`, 120d), idempotenter Tagesabschluss,  
Feedback an bestehendes `pv_bias` + geglätteter IH-kWh/°C-Faktor (Bounds).  
Deterministische Erklärung + AI-Explanation-Context mit Fakt-Validation.  
Notification-Candidates mit Dedup — kein Push.  
AI Authority Boundary: Plan B / Slot-Prefs nur advisory (Compare); keine Live-Mutation von  
`allocations` / IH/AC/Battery/Wallbox-Slices. Unified = alleinige Planwahrheit.  
Learning → Input → Unified bleibt aktiv.

### Schritt 8 — Beta Hardening + Production Surface + Release Candidate

Produkt-States: `operator.product_summary_de`, `operator.notification.*`,  
`operator.execution.effective_json` (Global∧Add-on). Cold-Start/Restore → Dryrun Native+States.  
Surface-Klassen PRODUCT/ADVANCED/…; BETA-DAY + BETA-GATE Tests.  
Details: `docs/EMS_LIGHT_BETA_CANDIDATE.md`.

### Nächste Schritte

1. Nach Prüfung: Beta Candidate committen / ggf. installieren.
2. Optional: Intent-Deadline stärker in Contribution verdrahten.

Nicht: isolierte Add-on-Patches als „EMS fertig“.
