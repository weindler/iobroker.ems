# EMS-Light — Battery Live Foundation (v0.1.178)

## 1. Zweck

Die Batterie hatte bereits vor v0.1.178 eine vollständige, verifizierte FSM (`runtime/fsm.ts`) mit Ownership, Feedback-Prüfung und Safe-Restore-Sequenz. Die Lücke lag in der letzten Verteidigungslinie unmittelbar vor dem realen Write (`FinalWriteGate`) und im Stop-Bedingungs-Slot `safety_blocked`: beide waren mit Platzhalter-Werten verdrahtet statt mit echtem Laufzeitzustand. v0.1.178 schließt diese Lücke und ergänzt einen eigenständigen, FSM-unabhängigen Failsafe.

## 2. Schichtenmodell

```text
Daily Plan / Manual Intent / Winter / Legacy Planner
        ↓
BatteryDeviceIntent (validateBatteryIntent)
        ↓
SonnenFsmContext → stepSonnenFsm() (idle…active…stop_charge…restore…completed/lockout)
        ↓
FinalWriteGate (unmittelbar vor jedem Write erneut geprüft)
        ↓
executeBatteryWrite() → writeForeignIfChanged()
```

Unabhängig davon: `failsafe.ts` (eigener Timer über `failsafe_runner.ts`) und `batteryUnloadRestore()` (Adapter-Unload) als zweite, von der FSM unabhängige Sicherheitsebene.

## 3. `FinalWriteGate` — vorher/nachher

Vor v0.1.178 (`src/addons/battery/index.ts`, Tick- und Unload-Gate):

```ts
fault: false,
lockout: false,
ownershipValid: true,
```

Seit v0.1.178, Tick-Gate:

```ts
const safetyWrite = isBatterySafetyWriteState(runtime.state) && runtime.ownership.active;
const foreignOwnershipConflict = isForeignManualControl({
	currentMode: modeRead.val,
	manualModeValue: config.sonnenModeValues.manual,
	ownership: runtime.ownership,
});
fault: runtime.faultCode !== null && !safetyWrite,
lockout: runtime.lockout && !safetyWrite,
ownershipValid: !foreignOwnershipConflict,
```

**Warum `&& !safetyWrite`:** Die Restore-Sequenz (`stop_charge → verify_charge_stopped → restore_self_consumption → verify_self_consumption → restore_grid_balance`, siehe `isBatterySafetyWriteState`) muss auch bei aktivem Fault/Lockout durchkommen — sonst bleibt die Batterie im unsicheren (ladenden) Zustand hängen, weil genau diese Writes den Fehlerzustand kontrolliert beenden. Das ist keine Lockerung der Sicherheit, sondern deren Voraussetzung: ohne diese Ausnahme würde ein Fault die Beendigung der Ladung selbst verhindern.

Unload-Gate (`batteryUnloadRestore`): bleibt bewusst `fault: false, lockout: false` (kommentiert im Code) — dieser Pfad läuft nur, wenn `runtime.ownership.active && ownershipLive` bereits als Precondition erfüllt ist, und ist selbst der Safety-Write-Pfad für den Adapter-Stop. `ownershipValid` spiegelt jetzt `runtime.ownership.active` statt eines Literals.

## 4. `evaluateStopCondition` — `fault` und `safety_blocked`

`src/addons/battery/runtime/safety.ts` (unverändert), Aufruf in `index.ts` jetzt:

```ts
fault: runtime.faultCode !== null,
safetyBlocked:
	runtime.ownership.active &&
	snapshot.limits.maxSocPct != null &&
	snapshot.telemetry.socPct != null &&
	snapshot.telemetry.socPct >= snapshot.limits.maxSocPct,
```

- **`fault`:** löst bei aktiven `STOPPABLE_STATES` (`wait_after_manual_mode`, `verify_manual_mode`, `set_charge_power`, `verify_charge_power`, `active`) sofort `stop_charge` aus. Ergänzt die bisher rein FSM-internen Fault-Trigger (Feedback-Timeouts) um externe Faultquellen (z. B. `foreign_manual_control` bei Adapter-Start).
- **`safety_blocked`:** Hardware-SOC-Obergrenze (`bat_hw_max_soc_pct`) — unabhängig vom Intent-eigenen `targetSocPct`. Schützt auch bei zielloser PV-Überschussladung (kein `targetSocPct` gesetzt) vor Überladung über die konfigurierte HW-Grenze hinaus. `limits.maxSocPct` ist zum Zeitpunkt einer aktiven Ladung immer gesetzt, da `validateBatteryIntent` sonst bereits mit `invalid_limits` abgelehnt hätte.

`unloading` und `higherPriorityIntent` bleiben im regulären Tick `false` — der Unload-Fall läuft über den separaten `batteryUnloadRestore()`-Pfad (bypasst die FSM ohnehin), eine formale Intent-Prioritätsordnung existiert noch nicht (siehe Abschnitt 7).

## 5. Failsafe (`src/addons/battery/failsafe.ts`, neu)

Eigenständiger Sicherheitspfad analog `addons/wallbox/failsafe.ts` / `addons/immersion_heater/failsafe.ts` — **kein** Bezug zur FSM, keine Abhängigkeit vom regulären Control-Tick:

- Getrieben vom globalen `failsafe_runner.ts`-Timer (Intervall `global_failsafe_check_interval_sec`, Default 30s).
- Löst aus, wenn `isEmsUnreachable(cfg, "bat")` — der interne EMS-Aktivitäts-Heartbeat (`ems_activity.ts`) länger als `bat_ems_unreachable_timeout_sec`/`global_ems_unreachable_timeout_sec` (Default 300s, Min. 60s) nicht mehr getouched wurde. Das erkennt einen hängenden Haupt-Tick-Loop, nicht nur einen sauberen Adapter-Stop.
- Schreibt bei Trip **direkt** (ohne Gate/FSM) `charge_power = 0`, danach `operating_mode = self_consumption` — bewusst ohne Verifikations-Loop, da die FSM (die genau das prüfen würde) im Trip-Fall per Definition nicht mehr zuverlässig läuft.
- Nur aktiv für Profile mit `supportsLive = true` (aktuell `sonnen_em`).
- States unter `addons.battery.failsafe.*`: `ems_reachable`, `would_trip` (Diagnose bei Dryrun), `active`, `last_failsafe_at`, `updated_at`.

`batteryUnloadRestore()` in `index.ts` bleibt für den **sauberen** Adapter-Unload zuständig (Precondition: aktive Ownership) — die beiden Pfade ergänzen sich: sauberer Stop vs. hängender/gecrashter Prozess.

## 6. Tests

- `runtime/safety.test.ts` (neu): vollständige Prioritätsreihenfolge von `evaluateStopCondition`.
- `runtime/restore.test.ts` (neu): `planSafeRestore` (Ownership-Voraussetzung, Grid-Balance-Wiederherstellung).
- `failsafe.test.ts` (neu): Profil-Gate, `ems_reachable`/`would_trip`-States, Clear von `failsafe_active` bei Wiederherstellung. Der eigentliche Zeit-Trip-Pfad (≥60s reale Wall-Clock-Zeit) ist — wie bei Wallbox/Heizstab — nicht ohne künstliche Zeitmanipulation unit-testbar und wird im Live-Betrieb verifiziert.
- `runtime/execute.test.ts`, `runtime/ownership.test.ts`: unverändert, weiterhin grün.

## 7. Bekannte, bewusst nicht adressierte Lücken

- `planSafeRestore()` (`runtime/restore.ts`) bleibt ungenutzt — die FSM implementiert dieselbe Sequenz bereits mit Feedback-Verifikation je Schritt, was strenger ist als der reine Plan. Getestet, aber nicht verdrahtet, um keine zweite Restore-Implementierung parallel zu pflegen.
- `higherPriorityIntent` in `evaluateStopCondition` bleibt `false` — es gibt noch keine formale Priorisierung zwischen aktiven Quellen (Manual > Daily Plan > Winter > Legacy Planner ist nur als Auswahlreihenfolge beim Aufbau des Intents kodiert, nicht als Stop-Signal für eine bereits laufende Ladung anderer Quelle).
- Kein neuer Admin-Config-Schlüssel für batterie-spezifische Failsafe-Timeouts (`bat_ems_unreachable_timeout_sec` etc.) — die globalen Fallbacks (`global_*`) reichen für den Start; analog Wallbox/Heizstab.

Siehe auch: `docs/EMS_LIGHT_BATTERY_DAILY_PLAN_RUNTIME.md`, `docs/ARCHITECTURE.md` (Abschnitt 12a).
