# EMS-Light Phase 3A — Global Modes & Policy Engine Foundation

**Adapter-Version:** v0.1.46  
**Status:** Implementiert  
**Scope:** Architekturschicht only — keine Planner-, Operator- oder Execution-Logik

---

## Ziel der Phase

Phase 3A schafft die gemeinsame Policy-Grundlage für alle bestehenden und zukünftigen Add-ons:

- **Global Modes** (`off`, `eco`, `balanced`, `comfort`, `forced`)
- **Zentrale Policy Engine** mit einheitlichem Vertrag
- **Configured vs. Effective Policy** mit Merge, Validierung, Herkunft und Revision

Die Engine beschreibt **Capabilities, Limits, Preferences, Protection, Economics** — niemals Geräteaktionen oder Planungsentscheidungen.

---

## Schichtenabgrenzung

```text
Live / Mapping
        ↓
Learning          (Phase 2 — read-only, unverändert)
        ↓
Global Modes      (Phase 3A)
        ↓
Policy Engine     (Phase 3A)
        ↓
Planner Input     (Phase 3B+ — nicht in 3A)
        ↓
Planner
        ↓
Operator
        ↓
Execution
```

**Verantwortlichkeiten:**

| Schicht | Aufgabe |
|---------|---------|
| Learning | Fakten liefern |
| Policy | Grenzen und Möglichkeiten definieren |
| Planner | Entscheiden |
| Operator | Erklären |
| Execution | Schreiben |

Phase 3A schreibt **ausschließlich** in `global_modes.*` und `policy.*`.

---

## Architektur (Code)

```text
src/global_modes/     — Mode-Auflösung, States, Persistenz
src/policy/core/      — Typen, Merge, Validierung, Hash, Registry
src/policy/global/    — Globale Policy (configured + effective)
src/policy/engine.ts  — Laufzeit-Orchestrierung
```

Integration: `initPolicyEngine()` aus `ems_light/index.ts` beim Adapterstart; Re-Run bei Änderung von `global_modes.requested`.

---

## Global Modes

| Mode | Kurzbedeutung |
|------|----------------|
| `off` | Flexible Optimierung deaktiviert; Schutz bleibt |
| `eco` | Wirtschaftlichkeit stark gewichtet |
| `balanced` | Standard |
| `comfort` | Komfort stärker gewichtet |
| `forced` | Benutzeranforderungen höchste Preference; Schutz unverändert |

**States:** `global_modes.requested` (beschreibbar), `active`, `available_json`, `effective_profile_json`, `status`, `valid`, `issues_json`, `revision`, `updated_at`

**Fallback:** Ungültiger `requested` → `active = balanced`, `valid = false`, `status = fallback`, Issue in `issues_json` (nie still).

**Admin:** `global_mode_default` (nur Erstinitialisierung / fehlender Laufzeitwert).

---

## Policy-Vertrag

Jede Policy enthält:

- `meta`, `capabilities`, `limits`, `preferences`, `protection`, `economics`
- `validation`, optional `provenance`

### PolicyValue

```ts
interface PolicyValue<T> {
  value: T | null;
  source: "default" | "admin" | "mapping" | "learning" | "global_mode" | "protection";
  strength: "hard" | "soft" | "advisory";
  valid: boolean;
  confidence?: number;  // 0.0 .. 1.0
  reason?: string;
}
```

**TriState** für Capabilities: `true | false | "unknown"` — kein stiller Fallback auf `false`.

### Configured vs. Effective

| Snapshot | Inhalt |
|----------|--------|
| **configured** | Admin, Defaults, statische Capabilities |
| **effective** | configured + Global Mode + (später) Mapping/Learning + Schutz + Normalisierung |

Effective Policy ist **keine Entscheidung**, sondern der gültige Handlungsrahmen für den Planner.

---

## Merge-Regeln (Kern)

| Regel | Verhalten |
|-------|-----------|
| Hartes Minimum | höchstes gültiges Minimum |
| Hartes Maximum | niedrigstes gültiges Maximum |
| Harte Booleans (Schutz) | `true + false → false` |
| Weiche Preferences | Global Mode darf überschreiben |
| Schutz | nur erhalten oder verschärfen |
| Learning | harte Limits nur bei `confidence ≥ 0.6` |
| Global Mode | darf Limits verschärfen, nicht erweitern |

---

## Validierung

- Einheitliche `PolicyIssue`-Struktur (`code`, `severity`, `path`, `message`)
- Deterministische Issue-Sortierung
- **Fail closed** bei sicherheitsrelevanten Fehlern (z. B. `min > max`, negative Leistung)
- Ungültige Policies: `valid = false`, `status = invalid`

---

## Provider-Registry

```ts
interface PolicyProvider<TConfig, TFacts> {
  id, addonType, instanceId, schemaVersion;
  readConfig(), readFacts();
  buildConfiguredPolicy(), buildEffectivePolicy();
  validate();
}
```

- Eindeutige Provider-ID und Add-on/Instance-Kombination
- Stabile Sortierung in `policy.system.registered_providers_json`
- **Phase 3A:** Kein produktiver Geräte-Provider — nur Registry + Vertrag

Zukünftige States: `policy.<addon>.<instance>.*`

---

## State-Struktur

### System

`policy.system.schema_version`, `engine_version`, `status`, `valid`, `issues_json`, `registered_providers_json`, `revision`, `updated_at`

### Global

`policy.global.configured_json`, `effective_json`, `provenance_json`, `status`, `valid`, `issues_json`, `revision`, `updated_at`

---

## Hash und Revision

- SHA-256 über stabil serialisierten Policy-Inhalt (Keys sortiert, kein `updated_at`)
- States werden nur bei geänderter Revision geschrieben
- Persistenz: `data/global_modes/global_modes_v1.json`, `data/policy/policy_global_v1.json`

---

## Laufzeitverhalten

1. Adapterstart → `initPolicyEngine`
2. Global Modes auflösen → Policy bauen → validieren → Revision hashen
3. States nur bei Änderung schreiben
4. Subscription auf `global_modes.requested`
5. Kein zusätzlicher High-Frequency-Timer

---

## Grenzen der Phase

**Nicht implementiert:** `planner_input.*`, `planner.*`, `operator.*`, Execution, Geräte-Writes, Add-on-spezifische Policies (Batterie, Wallbox, Heizstab, …).

**Nicht enthalten:** Aktionen, Commands, Zeitfenster, Priorisierung, `target_power_w`, `charge_now`, etc.

---

## Tests

Unit-Tests unter:

- `src/global_modes/resolve.test.ts`
- `src/policy/core/*.test.ts`

Abdeckung: Global Modes, Determinismus, Unknown-Handling, Merge, Validierung, Registry, State-Write-Optimierung.

---

## Vorbereitung Phase 3B

Phase 3B kann:

- Add-on-Policy-Provider registrieren (Batterie, Wallbox, Thermal Buffer, …)
- Mapping- und Learning-Fakten in `buildEffectivePolicy` einbinden
- `policy.<addon>.<instance>.*` States befüllen

Die Merge Engine und der Provider-Vertrag bleiben unverändert.
