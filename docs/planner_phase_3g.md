# EMS-Light Phase 3G — Controlled Takeover Authorization

Version: **0.1.143** (Branch `refactor/v0.1.143-on-demand-planner`)

## Warum Phase 3G noch kein Takeover ist

Phase 3G bereitet die manuelle Freigabezeremonie bis unmittelbar vor dem echten
Canonical-Permit-Mint vor. Am Ende kann das System feststellen:

```text
Alle fachlichen und manuellen Freigabefaktoren erfüllt,
aber produktive Aktivierungs-Capability fehlt.
```

Zustand: `activation_blocked`

Es entsteht **kein** `CanonicalPublishPermit`, kein Canonical Publish, kein Runtime-Konsum
des Candidates und kein Worker-Authority-Wechsel.

```text
ready + confirmed + grant  ≠  produktiver Takeover
```

## Native Autorisierungskonfiguration

Property: `planner_takeover_authorization_mode`

| Wert | Bedeutung |
|------|-----------|
| `disabled` | Default; keine Challenge/Grant; Prepare/Confirm abgelehnt |
| `manual_prepare` | Manuelle Prepare→Confirm-Zeremonie erlaubt |

Ungültige Werte werden auf `disabled` geclampt. Migration fehlender Werte → `disabled`.

Die Konfiguration verändert weder Planner-Modus noch Evaluationsmodus noch Evidence.

## Effektive Modusregeln

`manual_prepare` ist nur effektiv, wenn gleichzeitig gilt:

```text
planner_runtime_mode = shadow_auto
planner_takeover_evaluation_mode = observe
takeover evidence state = ready
```

Sonst ist die effektive Autorisierung `disabled` / nicht eligible.

## Eligibility-Faktoren (Prepare)

Mindestens alle gleichzeitig:

1. Adapter gestartet, kein Shutdown
2. Kein Restore-/Operation-Lock
3. Runtime `shadow_auto`, Evaluation `observe`, Auth `manual_prepare`
4. Evidence `ready`, Schema/Policy aktuell, nicht stale
5. Letzter Dual Run `matched`, kein neuerer Mismatch/Fehler
6. Authoritative-/Candidate-/Input-Revision vorhanden und generation/horizon match
7. Candidate validiert, authoritative Publish-Seal ok
8. Kein aktiver Planner-Job, kein Pending-Rerun
9. Execution Mode `dryrun`
10. Keine aktive Challenge/kein aktiver Grant

**Hinweis:** Das geschlossene produktive Release-Gate blockiert **nicht** die Challenge-Erzeugung.
Es blockiert weiterhin den echten Permit-Mint.

## Stabile Blockcodes

Kompakte Codes (Auszug): `authorization_disabled`, `runtime_mode_not_auto`,
`evaluation_not_observe`, `evidence_not_ready`, `evidence_stale`, `last_run_not_matched`,
`newer_mismatch`, `newer_failure`, `missing_*_revision`, `generation_mismatch`,
`horizon_mismatch`, `candidate_invalid`, `authoritative_publish_failed`,
`planner_job_active`, `pending_rerun`, `execution_mode_not_dryrun`,
`restore_barrier_active`, `operation_lock_active`, `adapter_not_ready`, `shutdown`,
`challenge_active`, `grant_active`, `release_gate_closed`, `activation_capability_missing`.

In ioBroker nur: primärer Blockgrund, Anzahl, optional kompakter Status.

## Prepare-/Confirm-Ablauf

1. User schreibt `prepare=true` mit `ack=false`
2. Eligibility → Challenge (TTL 10 min, revisions-/session-/instancegebunden, `crypto.randomUUID`)
3. System veröffentlicht `challenge_id`
4. User schreibt exakte ID in `confirm_challenge_id`, dann `confirm=true` (`ack=false`)
5. Prüfung: ID, TTL, nicht verbraucht, Session, Revisionen, Eligibility
6. Grant (TTL 5 min, In-Memory, WeakSet-Brand) → Preview → `activation_blocked`

Cancel löscht Challenge/Grant idempotent ohne Evidence-/Worker-/Publish-Nebenwirkungen.

## Challenge- und Grant-Bindung

Gebunden an: Adapterinstanz, Session, Generation, Input-/Candidate-/Authoritative-/Evidence-Revision,
Evidence-Policy, Planner-Vertragsversion, Snapshot-Schema, Horizont, Slotdauer,
Execution-Mode, Publish-Policy-Revision.

Jede Abweichung → `invalidated`. Keine tolerante Wiederverwendung.

## Ablauf / Invalidierung

Challenge TTL: `TAKEOVER_CHALLENGE_TTL_MS` = 10 min
Grant TTL: `TAKEOVER_AUTHORIZATION_GRANT_TTL_MS` = 5 min

Sofortige Invalidierung u. a. bei: Restart, Session-/Mode-/Execution-Wechsel, neuer Generation/Revision,
Mismatch/Fehler, Evidence-Verlust, Restore-/Operation-Lock, Shutdown, Cancel,
neuem Planner-Trigger/Job/Pending-Rerun, Candidate-Cleanup, Policy-/Gate-Änderung.

## Replay-Schutz

Nach Confirm: `challenge.consumed = true`. Replay-Cache (max 32 IDs) verhindert erneute Bestätigung
derselben Challenge-ID in der Session. Max. 3 Confirm-Fehlversuche → Challenge invalidiert.

## Race-Schutz

Serialisierte Authorization-Operationen (Promise-Mutex): max. eine Challenge, max. ein Grant,
Cancel/Shutdown/Revision-Invalidierung gewinnen vor Confirm/Permit-Preview.

## Audit

Datei: `ems-runtime.<instance>/planner/takeover/authorization_audit_v1.json`
Max 64 Einträge / 128 KiB. Nur gekürzte IDs, keine Pläne, keine PII. Fehler sind isoliert.

## Permit-Mint-Preview

Diagnostisch. Auch nach Confirm:

```text
authorizationState = activation_blocked
productiveActivationCapabilityPresent = false
permitMinted = false
canonicalAllowed = false
```

Kein Publish, kein Candidate-Move, keine Runtime-Umschaltung.

## Productive-Activation-Capability

Branded Capability ohne produktiven Erzeuger in Phase 3G.
Ein `CanonicalPublishPermit` erfordert:

```text
gültiger Authorization-Grant
UND
ProductiveTakeoverActivationCapability
```

Da die zweite Capability nicht erzeugbar ist, bleibt der Permit-Mint unerreichbar.

## Spätere Phase

Erst eine bewusst getrennte Phase darf die Productive-Activation-Capability unter zusätzlichen
unabhängigen Gates erzeugen — nicht über Config, States, Evidence oder Grant allein.
