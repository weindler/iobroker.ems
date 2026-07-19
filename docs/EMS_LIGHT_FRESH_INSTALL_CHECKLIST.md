# EMS-Light — Fresh Install / Namespace-Wipe Checklist

**Version:** 0.1.144+  
**Zweck:** Kontrollierter Neuaufbau des Objektbaums `ems.<instance>.*` nach Export — kein automatisches Löschen aus dem Adapter.

Siehe auch: [EMS_LIGHT_V0_1_140_STATE_TREE_RECOVERY.md](./EMS_LIGHT_V0_1_140_STATE_TREE_RECOVERY.md), [dynamic-state-lifecycle.md](./dynamic-state-lifecycle.md).

## Voraussetzungen

1. Adapter-Version mit Export-Register (Admin-Tab **Export** oder `backup.export_request`).
2. Produktivsystem erreichbar; Wartungsfenster geplant.
3. Notiert: Native-Config (Mappings, Geräte, Profile) — Admin speichern / Screenshot.

## Schritt A — Export-Gate

1. Admin → **Export** → „Export erstellen“ **oder** `ems.0.backup.export_request = true` (ack false).
2. Prüfen:
   - `backup.status` = idle (nicht error)
   - `backup.last_file_name` gesetzt (`.emsbackup`)
   - `backup.last_sha256` gesetzt
   - `info.backup.export_register_ready` = true
3. Datei vom Host sichern: `…/iobroker-data/ems-runtime.0/exports/backup/<last_file_name>`
4. **Ohne erfolgreichen Export keinen Wipe fortsetzen.**

## Schritt B — Adapter stoppen

1. Instanz `ems.0` stoppen.
2. Optional: zweites Backup der durable Daten `ems.0/` (Learning) kopieren.

## Schritt C — Objektbaum löschen

1. Nur Objekte unter `ems.0.*` (nicht fremde Adapter, nicht `alias.*`, nicht `userdata`).
2. Durable Dateien unter `ems.0/learning/` **behalten**, sofern Learning erhalten bleiben soll (sonst Restore aus Export später).
3. Optional Runtime leeren: `ems-runtime.0/` (Exports vorher gesichert).

## Schritt D — Start / Rebuild

1. Adapter starten (Cold-Start erzeugt Objektbaum neu).
2. Erwartung nach 4B1:
   - Keine AC-Platzhalter `unit_3..5`, wenn unkonfiguriert
   - Keine leeren Fahrzeugordner bei `wb_vehicle_profiles: []`
   - Planner `off` → Coordinator nur Kernstates
3. `info.backup.live_rearm_required` = true
4. Objektbaum-Modes folgen Admin (ab 0.1.144); **Writes** erst nach Live-Rearm

## Schritt E — Konfiguration & Live

1. Mappings / Geräte prüfen (Admin speichern falls nötig).
2. Steuerpfad: Daily Plan 0 W blockiert Heizstab/Klima **nicht** mehr still — Fallback auf Planner/Climate.
3. Explizit `global.execution_mode` → **live** setzen (frische Benutzeraktion).
4. Addon-Modes live setzen wo gewünscht.
5. Kurz testen: Heizstab bei Überschuss, Klima Off-Temp, keine Shadow-Authority.

## Schritt F — Abnahme

| Check | OK |
|-------|----|
| Export gesichert | |
| Keine unkonfigurierten AC-Units | |
| Heizstab reagiert auf Überschuss (nicht nur Daily Plan 0 W) | |
| Live-Writes erst nach Rearm | |
| `worker_authoritative` / `canonical_allowed` false | |
| RAM ~150–200 MiB | |

## Nicht tun

- Wipe ohne Export
- `vis/` in Cleanup-Commits mischen
- Authority/Takeover aktivieren „zum Testen“
- Compatibility-JSON-States pauschal löschen vor Reader-Migration
