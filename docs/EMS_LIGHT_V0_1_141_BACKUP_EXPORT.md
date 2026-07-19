# EMS-Light v0.1.141 — Backup Export & Support Bundle Foundation

## Zweck

Gemeinsame, versionierte Exportarchitektur für:

- **Restore ab v0.1.142:** siehe `docs/EMS_LIGHT_V0_1_142_MANUAL_RESTORE.md`
- **Support-Paket** (`.emssupport`) — anonymisiertes Diagnosepaket, kein Voll-Restore

## Nicht enthalten (v0.1.141)

- Kein Import / Restore
- Keine Backitup-Anbindung
- Keine automatische zeitgesteuerte Sicherung
- Keine Cloud-Übertragung
- Keine Geräteaktionen / Live-Writes

## Module

```
src/backup/     — gemeinsamer Exportkern
src/support/    — Diagnosemodus, Logrotation, Support-Sammlung
```

## Paketformat

ZIP-kompatible Archive mit `manifest.json` (zuletzt erzeugt, SHA-256 pro Datei).

```json
{
  "safety": {
    "restore_must_start_dryrun": true,
    "automatic_live_resume_allowed": false
  }
}
```

Diese Regel gilt verbindlich auch für v0.1.142 (Restore) und v0.1.143 (Backitup).

## Backup-Inhalt

```
manifest.json
config/adapter.json          — Allowlist-native Konfiguration
config/mappings.json
config/vehicle_profiles.json
config/policies.json
persistence/learning.json
persistence/user_settings.json
persistence/selected_state_data.json
metadata/inventory.json
```

Ausführungsmodi werden zur Nachvollziehbarkeit exportiert, mit `restore_policy.apply_as: "dryrun"`.

## Support-Inhalt

Anonymisiert via zentrale Sanitizer-Schicht (`sanitize.ts`):

- Secrets entfernt (schlüsselbasiert)
- VIN, IP, MAC, Pfade pseudonymisiert
- Kein vollständiger `ems.0.*`-Dump
- Abschließender Secret-Scan — bei Treffer bricht Export ab

## Diagnosemodus

- Nur durch Benutzeraktion (`support.diagnostic_request`)
- Laufzeiten: 15 / 30 / 60 / 120 Minuten (Standard 60, Max 120)
- Kein globales ioBroker-Loglevel
- Nach Neustart standardmäßig aus
- NDJSON-Logs mit Rotation (max. 3 MiB gesamt)

## Export-Register (Admin, ab v0.1.144)

Admin-Tab **Export**: Button „Export erstellen“ sendet `requestBackupExport` und setzt `backup.export_request`.

Zusätzlich in `persistence/selected_state_data.json`:

- `consumer_stats_v1.json` (Consumer-Laufzeiten/Energie)

Pfad auf dem Host: `ems-runtime.<instance>/exports/backup/`.
Status: `info.backup.export_register_ready`, `info.backup.export_register_hint`.

Wetter-Tagesdateien unter `learning/weather/*.json` sind bewusst **nicht** im Restore-Allowlist (viele Tagesdateien); Support-Bundle kann Diagnosen liefern.


Archive liegen unter `<instanceDataDir>/exports/backup/` bzw. `.../support/`.

Retention: max. 10 Backups, max. 5 Support-Pakete.

## Manuelle Nutzung

1. `backup.export_request` auf `true` setzen → `.emsbackup` erzeugen
2. `backup.support_export_request` auf `true` setzen → `.emssupport` erzeugen
3. Optional: `support.diagnostic_request` + `support.diagnostic_duration_min` für Diagnosemodus

Ergebnis in `backup.last_*` / `support.last_*` States.

## Referenz

- Implementierung: `src/backup/service.ts`, `src/support/diagnostic_mode.ts`
- Tests: `src/backup/export.test.ts`
- Integration: `src/main.ts`, Phase B `ensureBackupStates`
