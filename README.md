# ioBroker EMS V2 Adapter (`iobroker.ems`)

Execution gateway between **EMS V2** and **ioBroker** (dryrun/live, mapping, audit).

**v0.1.0 (breaking):** Object tree under `addons.<id>.mapping|dryrun|status`, global `execution_mode`, live writes when `global.live ∧ addon.live`. Delete old `ems.0` tree before upgrade.

**v0.0.9:** Instanz-Admin: Wallbox-Mapping per **State wählen**. Optional Button „go-e Vorlage“.

**v0.0.7:** Full dryrun check chain.

Concept docs: EMS project `docs/iobroker_adapter/`.

## Install (ioBroker host)

```bash
iobroker url install github:weindler/iobroker.ems#v0.1.0
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

Configure mapping in **instance settings** (tabs Global / Wallbox): pick target states or use optional **go-e template** button. After save + adapter restart, values appear under `ems.0.addons.wallbox.mapping.*`.

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
- `target_state`: `go-e.0.amperePV` (go-e API `amx`; not `ampere`/`amp` — Flash wear)
- `planned_value`: `{ "watts": 4200, "ampere": 18, ... }`

Also check dryrun states, e.g. `ems.0.addons.wallbox.dryrun.target_state`, `planned_ampere`, `result`, and `audit.wallbox.last_event`.

## Safety defaults

- `ems.0.global.execution_mode` = `dryrun`
- `ems.0.addons.<id>.mode` = `dryrun` — live device writes only when both are `live`

## Development

```bash
npm ci
npm run build
npm run check
```

## License

MIT
