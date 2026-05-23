# ioBroker EMS V2 Adapter (`iobroker.ems`)

Execution gateway between **EMS V2** and **ioBroker** (dryrun/live, mapping, audit).

**v0.0.1:** Creates `ems.<instance>.` states, accepts JSON commands on `command.inbox`, runs **dryrun-only** pipeline (no writes to device states).

Concept docs: [EMS repo `docs/iobroker_adapter/`](https://github.com/weindler/iobroker.ems) (in your EMS project).

## Install (ioBroker host)

```bash
iobroker url install github:weindler/iobroker.ems#v0.0.2
```

Or from git checkout:

```bash
cd /opt/iobroker.ems   # or your clone path
npm ci
npm run build
iobroker dev install .
```

Then: **Adapters → EMS V2 → add instance** (default instance `0` → namespace `ems.0`).

## Test command (Admin → States)

Set `ems.0.command.inbox` (ack = true) to:

```json
{
  "intent_id": "test-1",
  "addon_id": "wallbox",
  "command": "set_charge_power_w",
  "value": 4200,
  "source": "manual"
}
```

Check `ems.0.command.last_result` and `ems.0.audit.wallbox.last_event`.

## Safety defaults

- `ems.0.config.execution_enabled` = `false` on first start
- No mapping / no live writes in v0.0.1

## Development

```bash
npm ci
npm run build
npm run check
```

## License

MIT
