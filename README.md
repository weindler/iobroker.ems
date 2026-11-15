![Logo](admin/ems.png)

# ioBroker.ems — EMS-Light

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Energy management for ioBroker that plans PV surplus, dynamic prices and flexible loads together — and does it safely: **every device starts in dry-run**, nothing is written to hardware until you explicitly switch it to live.

> **Status: beta.** Developed and run on one real installation (Sonnen battery, evcc wallbox, Tibber, heat rod, air conditioners). Expect rough edges on other setups. The admin UI is currently **German-first** (English translation in progress). [Deutsche Beschreibung → README.de.md](README.de.md)

## What it does

EMS-Light builds **one common daily plan** (rolling 72 h) from the PV forecast, electricity prices, learned house load and all enabled consumers, and then allocates energy to the devices:

- **PV forecast with learning** – main forecast corrected by a learned bias and an intraday correction; [Bright Sky](https://brightsky.dev) hourly/daily data as second source and cross-check.
- **Dynamic prices** – hourly/quarter-hour prices from your tariff integration (e.g. Tibber), optionally extended by [Energyforecast](https://www.energyforecast.de) (API token, longer look-ahead). Optional weekly comparison tariff for the statistics.
- **Battery** – reserve for the night is learned from your real consumption, not a fixed percentage. Sonnen profile (`sonnen_em`) and a generic read-only profile. Charging from the grid is done through evcc. Optional "grid balance" (discharge only when the price makes it worthwhile) with a dynamic threshold based on the battery's replacement cost and a learned efficiency.
- **Wallbox / EV** – via the [evcc adapter](https://github.com/evcc-io/evcc) (evcc stays the only wallbox controller).
- **Heat rod and air conditioning** – runtime, comfort limits, shared outdoor unit power is counted once, manual operation is respected (device ownership).
- **Measured consumers** – up to 20 measured-only loads for statistics (never switched).
- **Statistics** – day/month/period balance, self-sufficiency, self-consumption, cost and EMS added value.
- **Operations page** (`/adapter/ems/ems-charts.html?inst=ems.0`, also in the admin) – situation, 72 h decisions, PV forecast vs. Bright Sky vs. measured, price forecast vs. actual, battery, heat, climate, EV.
- **Backup / restore** of configuration and learned data from the admin (download, list, delete old backups).
- **Optional AI daily analyst** – advisory text only; it never changes the plan or switches devices.

### Safety model

| Level | Meaning |
|---|---|
| Global **dry-run** | plans and simulates, writes nothing to any device |
| Global **live** + add-on **live** | a device is only written if both are live, safety checks pass and the capability is allowed |
| Fail-safe | if the adapter loop stops, the battery is returned to a safe state (0 W, self-consumption) |
| Fresh install / restore | always starts in dry-run |

## Requirements

- ioBroker with **js-controller ≥ 5.0.19**, **admin ≥ 6.0.0**, **Node.js ≥ 20**
- A PV, grid and house-load source as ioBroker states (mapped in the admin — any adapter works)
- Optional, depending on your hardware: [evcc](https://github.com/evcc-io/evcc) adapter, a Sonnen adapter, a Tibber adapter, [Bright Sky](https://github.com/ioBroker/ioBroker.brightsky) adapter, Home Assistant adapter (Tibber Grid Rewards)
- Runs in compact mode. Plan for roughly 400–600 MB RSS on large installations.

## Installation

Until the adapter is in the repository, install from GitHub:

```bash
iobroker url https://github.com/weindler/iobroker.ems
```

Then add an instance, open the settings and work through the tabs: **Global** (data sources, devices, price source, strategy) → device tabs (keep them in dry-run) → **Statistics** / **Learning**. Check the operations page for a day or two before switching anything to live.

## Data and privacy

The adapter runs locally. Outgoing connections happen **only** for the features you enable: Bright Sky (weather/solar), Energyforecast (token, stored encrypted), SMARD/Verivox (optional price statistics/comparison tariff), OpenAI (optional AI analyst, key required). Learned data is stored in the adapter's own data folder `ems.<instance>`; no data is sent to the author.

## Documentation

Developer and design documents are in [docs/](docs/README.md) (German).

## Changelog

The full history (German) is in [CHANGELOG.md](CHANGELOG.md).

### **WORK IN PROGRESS**
- PV forecast chart on the operations page: EMS forecast, Bright Sky and measured values; week view with daily totals
- Price chart: look-back of 48 h with stored real prices and the earlier Energyforecast forecast

### 0.4.90 (2026-11-15)
- Lower memory churn in the planning run (time-zone conversion, forecast source bounds, forecast revisions)

### 0.4.89 (2026-11-15)
- Price look-back and PV week view

### 0.4.87 (2026-11-15)
- Battery efficiency is now learned from a multi-day balance instead of single-day sessions

## License

MIT License

Copyright (c) 2026 weindler

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
