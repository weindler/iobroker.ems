# EMS-Light — Wallbox Feedback Contract (v0.1.137)

## 1. Schichtenmodell

```text
Daily Plan / Dispatch
        ↓
WallboxCommandCandidate
        ↓
WallboxWritePlan
        ↓
WallboxFeedbackContract
        ↓
executeWallboxWrite()   ← Release-Gate geschlossen
```

Der Feedback-Vertrag beschreibt, **wie** spätere Writes anhand vorhandener Telemetrie überprüft werden könnten. In v0.1.137 gibt es keine aktive Überwachung.

## 2. Drei getrennte Begriffe

| Begriff | Bedeutung |
|---------|-----------|
| `writeContractReady` | Strukturell vollständiger Write-Plan |
| `feedbackContractReady` (Write-Plan) | Alle required Operations haben Readback-States |
| `feedbackContract.ready` (Feedback-Vertrag) | Erwartungen vollständig, keine Cross-Controller-Konflikte |
| `liveEligible` | Strukturelle EVCC-Control-Pfad-Eignung — keine Write-Freigabe |

Für spätere Live-Freigabe voraussichtlich: alle vier Bedingungen erfüllt. In v0.1.137 wird das nur dokumentiert.

## 3. Feedback-Vertrag

```typescript
WallboxFeedbackContract {
  required, ready, writePlanRevision, controlModel,
  expectations[], timeoutMs, settleTimeMs,
  status, issueKind, blockReason, createdAt
}
```

Vollständig serialisierbar — keine Host-Referenzen, keine Timer, keine Funktionen.

### Statuswerte

| Status | Bedeutung |
|--------|-----------|
| `not_required` | Gültiger No-op (`action=none`) |
| `unavailable` | Readback fehlt, Vertrag unvollständig, kein Write ausgeführt |
| `pending` | Nur bei simuliertem Write + ausstehende Erwartungen |
| `matched` | Alle Erwartungen erfüllt |
| `mismatch` | Abweichung nach Settle-Time, vor Timeout |
| `timeout` | Timeout überschritten |
| `invalid` | Readback-Wert typ- oder semantikwidrig |

Ohne `writeTimestamp` meldet die Runtime **kein** dauerhaftes `pending`, `matched` oder `timeout`.

## 4. Ableitung aus Write-Plan

`buildWallboxFeedbackContract({ writePlan, feedbackConfig, now })` — rein funktional, kein IO.

| Aktion | Erwartungen |
|--------|-------------|
| `none` | `not_required`, leer |
| `hold` | nur bei bestätigter `set_mode`-Operation; sonst `hold_feedback_contract_unavailable` |
| `charge_start` (EVCC) | `set_max_current_a` + `set_mode` |
| `charge_adjust` (EVCC) | nur `set_max_current_a` |

## 5. EVCC-Readbacks

| Write-Rolle | Readback |
|-------------|----------|
| `set_max_current_a` | `wb_evcc_max_current_a_state` |
| `set_mode` | `intent_evcc_mode_state` |

**Semantik maxCurrent:** erwarteter Wert ist die EMS-Stromobergrenze — nicht der tatsächlich fließende Ladestrom, nicht `minCurrent`, nicht Ladeleistung.

**Mode:** `enabled` ist kein Mode-Write-Readback.

## 6. Cross-Controller-Sperre

Write-Ziel und Readback müssen derselben Steuerungsebene angehören:

| Write | Readback | Ergebnis |
|-------|----------|----------|
| `go-e.*` | `evcc.*` | `cross_controller_feedback_unsupported` |
| `evcc.*` | `go-e.*` | `cross_controller_feedback_unsupported` |
| `evcc.*` | `evcc.*` | erlaubt |

Keine indirekte Bestätigung über zufällige Telemetrie.

## 7. Normalisierung

`normalizeWallboxFeedbackValue({ role, rawValue, expectedType, objectMeta })`

- **Zahlen:** endliche Werte; negative Ampere abgelehnt; keine `NaN`/`Infinity`
- **Boolean:** nur echter `boolean`-Typ — keine implizite Konvertierung von `1`/`"true"`
- **String/Enum:** exakter Vergleich; `common.states` prüfen

## 8. Soll-/Ist-Vergleich

`evaluateWallboxFeedback({ contract, actualValues, evaluationTimeMs, writeTimestampMs })`

| Typ | Regel |
|-----|-------|
| string / boolean | exakt `actual === expected` |
| number | `Math.abs(actual - expected) <= tolerance` |

Default-Toleranz für `maxCurrent`: **0 A** (exakter Vergleich).

## 9. Settle-Time und Timeout

| Parameter | Default | Quelle |
|-----------|---------|--------|
| `settleTimeMs` | 5000 | Batterie-Konvention (`wait_after_mode`) |
| `timeoutMs` | 30000 | Batterie-Konvention; optional `wb_verification_timeout_sec` / `global_verification_timeout_sec` |

Regeln: `settleTimeMs >= 0`, `timeoutMs > settleTimeMs`.

**Keine aktiven Timer** in v0.1.137 — nur Vertragsdefinition.

## 10. Fehlerklassifikation

`WallboxFeedbackIssueKind`: `none`, `mapping`, `unavailable`, `invalid_value`, `mismatch`, `timeout`, `cross_controller`, `unsupported`

Keine Fault-FSM, kein Lockout, kein Restore.

## 11. Runtime-Phasen

| Phase | Feedback-Vertrag |
|-------|------------------|
| `observe` | nein |
| `dryrun` | ja, Diagnose — `status=unavailable`, `feedback_write_not_executed` |
| `live` | ja + Execution blockiert am Release-Gate |

## 12. Diagnose-States

Unter `addons.wallbox.runtime.*`:

* `feedback_contract_present`
* `feedback_contract_json`
* `feedback_required`
* `feedback_contract_structural_ready`
* `feedback_status`
* `feedback_block_reason`
* `feedback_issue_kind`
* `feedback_expectation_count`
* `feedback_matched_count` / `mismatch` / `unavailable` / `invalid`
* `feedback_settle_time_ms` / `feedback_timeout_ms`

## 13. Release-Gate

```ts
WALLBOX_LIVE_WRITE_RELEASED = false;
```

## 14. Nicht enthalten

* keine Write-Ausführung
* kein aktives Polling / Retry
* kein Ownership / Restore
* kein Lockout
* keine reale Timeout-Auslösung
* keine Änderung an Heizstab, Klima, Batterie

Siehe auch: `docs/EMS_LIGHT_WALLBOX_EVCC_WRITE_CONTRACT.md`, `docs/EMS_LIGHT_WALLBOX_EVCC_CONTROL_MAPPING.md`
