/**
 * Lightweight authority action bridge — service loaded only on conscious activate.
 * Primary button IDs live under planner.authority.*; the planner.takeover.* aliases
 * are accepted for compatibility and map to the same handlers.
 */

import type { StateHost } from "../ems_light/state_util";
import { PLANNER_AUTHORITY_STATE_IDS, isPlannerAuthorityState } from "./states";

export type AuthorityActionHost = StateHost & {
	log?: Pick<ioBroker.Logger, "debug" | "info" | "warn" | "error">;
};

const ALIAS_ACTIVATE = "planner.takeover.activate_worker_dryrun";
const ALIAS_DEACTIVATE = "planner.takeover.deactivate_worker";

function isConsciousButton(val: unknown, ack: boolean | undefined): boolean {
	return val === true && ack !== true;
}

export function isPlannerAuthorityActionState(relativeId: string): boolean {
	return (
		isPlannerAuthorityState(relativeId) ||
		relativeId === ALIAS_ACTIVATE ||
		relativeId === ALIAS_DEACTIVATE
	);
}

export async function handlePlannerAuthorityStateChange(
	host: AuthorityActionHost,
	relativeId: string,
	val: unknown,
	ack: boolean | undefined,
	handlers: {
		activateWorkerDryrun: () => Promise<unknown>;
		deactivateWorker: () => Promise<unknown>;
	},
): Promise<boolean> {
	if (!isPlannerAuthorityActionState(relativeId)) return false;

	const isActivate =
		relativeId === PLANNER_AUTHORITY_STATE_IDS.activateWorkerDryrun || relativeId === ALIAS_ACTIVATE;
	const isDeactivate =
		relativeId === PLANNER_AUTHORITY_STATE_IDS.deactivateWorker || relativeId === ALIAS_DEACTIVATE;

	if (isActivate) {
		if (!isConsciousButton(val, ack)) return true;
		await host.setStateAsync(relativeId, { val: false, ack: true });
		await handlers.activateWorkerDryrun();
		return true;
	}
	if (isDeactivate) {
		if (!isConsciousButton(val, ack)) return true;
		await host.setStateAsync(relativeId, { val: false, ack: true });
		await handlers.deactivateWorker();
		return true;
	}
	return true;
}
