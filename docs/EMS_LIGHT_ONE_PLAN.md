# EMS-Light — Ein Plan (Kanondokument)

**Stand:** 04.08.2026  
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

### Nächste Schritte

1. Nachplanung verdrahten wenn Live vom Plan abweicht.
2. Battery/Wallbox Unified-Live erst nach Validierung.
3. Kein isolierter Add-on-Patch als Ersatz für den gemeinsamen Plan.

Nicht: isolierte Add-on-Patches als „EMS fertig“.
