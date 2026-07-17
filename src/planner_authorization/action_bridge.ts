/**
 * Lightweight action bridge — heavy service loaded only on conscious prepare/confirm.
 */

import type { StateHost } from "../ems_light/state_util";
import { PLANNER_AUTHORIZATION_STATE_IDS, isPlannerAuthorizationState } from "./states";

export type AuthorizationActionHost = StateHost & {
	log?: Pick<ioBroker.Logger, "debug" | "info" | "warn" | "error">;
};

function isConsciousButton(val: unknown, ack: boolean | undefined): boolean {
	return val === true && ack !== true;
}

export async function handlePlannerAuthorizationStateChange(
	host: AuthorizationActionHost,
	relativeId: string,
	val: unknown,
	ack: boolean | undefined,
	handlers: {
		prepare: () => Promise<unknown>;
		confirm: (challengeId: string) => Promise<unknown>;
		cancel: () => Promise<unknown>;
		getConfirmChallengeId: () => Promise<string>;
	},
): Promise<boolean> {
	if (!isPlannerAuthorizationState(relativeId)) return false;

	if (relativeId === PLANNER_AUTHORIZATION_STATE_IDS.prepare) {
		if (!isConsciousButton(val, ack)) return true;
		await host.setStateAsync(relativeId, { val: false, ack: true });
		await handlers.prepare();
		return true;
	}
	if (relativeId === PLANNER_AUTHORIZATION_STATE_IDS.confirm) {
		if (!isConsciousButton(val, ack)) return true;
		await host.setStateAsync(relativeId, { val: false, ack: true });
		const id = await handlers.getConfirmChallengeId();
		await handlers.confirm(id);
		await host.setStateAsync(PLANNER_AUTHORIZATION_STATE_IDS.confirmChallengeId, { val: "", ack: true });
		return true;
	}
	if (relativeId === PLANNER_AUTHORIZATION_STATE_IDS.cancel) {
		if (!isConsciousButton(val, ack)) return true;
		await host.setStateAsync(relativeId, { val: false, ack: true });
		await handlers.cancel();
		await host.setStateAsync(PLANNER_AUTHORIZATION_STATE_IDS.confirmChallengeId, { val: "", ack: true });
		return true;
	}
	return true;
}
