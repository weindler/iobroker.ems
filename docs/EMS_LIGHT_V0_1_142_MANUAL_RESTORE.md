# EMS-Light v0.1.142 — Manual Restore Foundation

## Zweck und Grenzen

v0.1.142 ermöglicht die **manuelle Wiederherstellung** aus intern vorhandenen `.emsbackup`-Archiven (Export ab v0.1.141).

**Enthalten:**

- Zweistufiger Ablauf: Validate → Plan-ID bestätigen → Apply
- Vollständige Archivvalidierung (ZIP Store, CRC, Manifest, SHA-256)
- Allowlistbasierter Konfigurations-Merge (Secrets und unbekannte Native-Felder bleiben lokal)
- Wiederherstellung der acht freigegebenen Learning-Dateien
- Transaktion mit Journal, Rollback und Startup-Recovery
- Zwingender Dryrun auf global und allen Add-ons nach Restore
- `restart_required` — kontrollierter Adapterneustart erforderlich

**Nicht enthalten:**

- Kein Restore aus `.emssupport`
- Kein Backitup, kein Cloud-Download, kein freier Dateipfad
- Keine automatische Live-Freigabe
- Kein Restore aktiver Runtimezustände oder Secrets

## Unterstützte Paketart

Nur **`.emsbackup`** mit `kind: "backup"` und gültigem Safety-Block:

```json
{
  "restore_must_start_dryrun": true,
  "automatic_live_resume_allowed": false
}
```

`.emssupport` wird abgewiesen (`restore.supported: false`).

## Erlaubte Verzeichnisse

Archive müssen bereits unter einem dieser Pfade liegen:

```text
<instanceDataDir>/exports/backup/
<instanceDataDir>/restore/inbox/
```

Der Benutzer wählt nur den **Dateinamen** (keine absoluten Pfade in States).

## Ablauf

### 1. Backup manuell bereitstellen

Kopieren Sie eine `.emsbackup`-Datei nach `restore/inbox/` oder nutzen Sie ein vorhandenes Export unter `exports/backup/`.

### 2. Dateiname auswählen

State: `backup.restore.selected_file` = z. B. `ems-light-0.1.141-backup-….emsbackup`

### 3. Validate auslösen

`backup.restore.validate_request` = `true` (nur bei `ack=false`).

Validate:

- validiert das Archiv vollständig
- erzeugt einen Restore-Plan (15 Minuten gültig, einmal verwendbar)
- schreibt Vorschau nach `backup.restore.summary_json`
- setzt `backup.restore.plan_id` und `backup.restore.plan_expires_at`
- **ändert keine** Konfiguration, Learning-Daten oder Runtime

### 4. Vorschau prüfen

`summary_json` enthält nur neutrale Informationen (Dateiname, Version, Anzahl geänderter Felder, Profile, Learning-Dateien, Warnungen, gespeicherte Modi, anzuwendende Modi immer `dryrun`). Keine Secrets, keine VIN, keine absoluten Pfade.

### 5. Plan-ID bestätigen

`backup.restore.confirm_plan_id` = exakt die angezeigte Plan-ID.

### 6. Apply auslösen

`backup.restore.apply_request` = `true` (nur bei `ack=false`).

Apply prüft Plan, Archividentität erneut, setzt Dryrun, wendet Config und Learning transaktional an, bereinigt Runtime und setzt `backup.restore.restart_required = true`.

### 7. Verhalten während Restore

- Restore-Barriere aktiv (`restore_in_progress`)
- Keine Wallbox-, Batterie-, Heizstab- oder Klima-Writes
- Keine parallelen Exporte/Restores

### 8. Rollback

Bei Fehler nach Transaktionsstart: automatischer Rollback aus `before/`-Snapshot, Dryrun bleibt erzwungen, frühere Live-Modi werden **nicht** reaktiviert.

### 9. Restart-required und kontrollierter Neustart

Nach erfolgreichem Apply:

1. Restore-Ergebnis und `summary_json` prüfen
2. Adapter **kontrolliert neu starten**
3. Dryrun-Modi prüfen (global, Wallbox, Batterie, Heizstab, Klima)
4. Mappings prüfen
5. Fahrzeugprofile prüfen
6. Learning-Status prüfen
7. Live später **bewusst** neu freigeben

Bis zum Neustart bleibt die Restore-Barriere aktiv.

Nach erfolgreichem Post-Restore-Bootstrap wird `restart_required` zurückgesetzt.

## Unterbrochene Transaktionen

Beim Adapterstart vor normalem Bootstrap:

- Unvollständige Journale → Rollback aus `before/`
- `committed` → Dryrun erneut, Runtime-Cleanup idempotent, kein erneutes Apply
- Mehrere offene Journale → Runtime blockiert (`multiple_incomplete_restore_transactions`)

Transaktionsverzeichnis:

```text
<instanceDataDir>/restore/transactions/<transaction_id>/
  journal.json
  before/native_projection.json, before/learning/
  staged/native_projection.json, staged/learning/
```

## Secrets

Backup enthält keine Secrets. Lokale Passwörter, Tokens und unbekannte Native-Felder bleiben erhalten.

## Learning

Wiederherstellbare Keys (festes Mapping):

| Backup-Key | Ziel |
|------------|------|
| `battery_runtime_learning_v1.json` | `learning/battery_runtime/` |
| `house_load_learning_v1.json` | `learning/house_load/` |
| `thermal_runtime_learning_v1.json` | `learning/thermal_runtime/` |
| `price_learning_v1.json` | `learning/price_learning/` |
| `price_forecast_learning_v1.json` | `learning/price_forecast/` |
| `pv_bias_daily_v1.json` | `learning/pv_bias/` |
| `power_hourly_v1.json` | `learning/power_rollup/` |
| `energy_daily_v1.json` | `learning/energy_daily_rollup/` |

Fehlt ein bekannter Key im Backup, wird die entsprechende Zieldatei entfernt (rollbackfähig). Unbekannte Dateien in Learning-Verzeichnissen werden nicht gelöscht.

## Restore-States

```text
backup.restore.selected_file
backup.restore.validate_request
backup.restore.status
backup.restore.running
backup.restore.plan_id
backup.restore.plan_expires_at
backup.restore.archive_sha256
backup.restore.summary_json
backup.restore.confirm_plan_id
backup.restore.apply_request
backup.restore.transaction_id
backup.restore.last_restore_at
backup.restore.last_file_name
backup.restore.last_result
backup.restore.last_error
backup.restore.restart_required
```

## Implementierung

- `src/restore/` — Restore-Kern
- `src/backup/operation_lock.ts` — gemeinsamer Lock für Export und Restore
- Tests: `src/restore/restore.test.ts`

## Keine Backitup-Integration

Backitup-Anbindung ist für v0.1.143 vorgesehen, nicht in v0.1.142.
