import { setStateIfChanged } from "../../policy/core/state_write";
import type { StateHost } from "../../ems_light/state_util";
import { consumerStatsStateIds } from "./ensure_states";
import type { ConsumerStatsSnapshot } from "./types";

export async function publishConsumerStats(
	host: StateHost,
	addonId: string,
	snapshot: ConsumerStatsSnapshot,
): Promise<void> {
	const ids = consumerStatsStateIds(addonId);
	await setStateIfChanged(host, ids.tracking, snapshot.tracking);
	await setStateIfChanged(host, ids.deviceActive, snapshot.deviceActive);
	await setStateIfChanged(host, ids.todayRuntimeSec, snapshot.todayRuntimeSec);
	await setStateIfChanged(host, ids.todayEnergyKwh, snapshot.todayEnergyKwh);
	await setStateIfChanged(host, ids.totalRuntimeSec, snapshot.totalRuntimeSec);
	await setStateIfChanged(host, ids.totalEnergyKwh, snapshot.totalEnergyKwh);
	await setStateIfChanged(host, ids.sessionRuntimeSec, snapshot.sessionRuntimeSec);
	await setStateIfChanged(host, ids.sessionEnergyKwh, snapshot.sessionEnergyKwh);
	await setStateIfChanged(host, ids.lastSessionRuntimeSec, snapshot.lastSessionRuntimeSec);
	await setStateIfChanged(host, ids.lastSessionEnergyKwh, snapshot.lastSessionEnergyKwh);
	await setStateIfChanged(host, ids.lastUpdated, snapshot.lastUpdated);
}
