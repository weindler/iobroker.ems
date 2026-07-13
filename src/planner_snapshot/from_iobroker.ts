import { buildPlannerInputSnapshot } from "./builder";
import { CachedPlannerSnapshotSource } from "./source";
import { IoBrokerPlannerSnapshotSource, type PlannerSnapshotClock, type PlannerSnapshotIoBrokerHost } from "./iobroker_source";
import type { PlannerInputSnapshot } from "./types";

export interface BuildPlannerInputSnapshotFromIoBrokerOptions {
	clock?: PlannerSnapshotClock;
}

/**
 * Builds a planner input snapshot from ioBroker reads.
 * No side effects — does not write files or spawn workers.
 */
export async function buildPlannerInputSnapshotFromIoBroker(
	host: PlannerSnapshotIoBrokerHost,
	options: BuildPlannerInputSnapshotFromIoBrokerOptions = {},
): Promise<PlannerInputSnapshot> {
	const raw = new IoBrokerPlannerSnapshotSource(host, options.clock);
	const cached = new CachedPlannerSnapshotSource(raw);
	return buildPlannerInputSnapshot(cached);
}
