# ioBroker EMS V2 Adapter (`iobroker.ems`)

Execution gateway between **EMS V2** and **ioBroker** (dryrun/live, mapping, audit).

**v0.0.8:** Dryrun **flat states** under `dryrun.<addon>.*` (target_state, planned_ampere, …) — readable in Admin without parsing JSON. Still no device writes.

**v0.0.7:** Full dryrun check chain, wallbox → go-e mapping defaults.

Concept docs: EMS project `docs/iobroker_adapter/`.

## Install (ioBroker host)

```bash
iobroker url install github:weindler/iobroker.ems#v0.0.8
```

Or from git checkout:

```bash
cd /path/to/iobroker.ems
npm ci
npm run build
iobroker dev install .
```

Then: **Adapters → EMS V2 → add instance** (default `0` → namespace `ems.0`).

Update existing instance:

```bash
iobroker update ems
```

## Wallbox test (go-e)

After start, defaults are created under `ems.0.mapping.wallbox.*`:

| Command | Default target |
|---------|----------------|
| `set_enabled` | `go-e.0.allow_charging` |
| `set_current_a` | `go-e.0.ampere` |
| `set_charge_power_w` | `go-e.0.ampere` (W→A in dryrun) |
| `set_phase_switch_enabled` | `go-e.0.phaseSwitchModeEnabled` |

Set `ems.0.command.inbox` with **ack = false** (Admin „set value“):

```json
{
  "intent_id": "test-1",
  "addon_id": "wallbox",
  "command": "set_charge_power_w",
  "value": 4200,
  "source": "manual"
}
```

Expected in `ems.0.command.last_result`:

- `result`: `dryrun_only`
- `target_state`: `go-e.0.ampere`
- `planned_value`: `{ "watts": 4200, "ampere": 18, ... }`

Also check flat dryrun states, e.g. `ems.0.dryrun.wallbox.target_state`, `planned_ampere`, `result`, and `audit.wallbox.last_event`.

## Safety defaults

- `ems.0.config.execution_enabled` = `false` on first start
- `ems.0.addons.<id>.mode` = `dryrun` (live does not write in v0.0.7)

## Development

```bash
npm ci
npm run build
npm run check
```

## License

MIT
