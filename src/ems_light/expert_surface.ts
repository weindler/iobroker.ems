/** ioBroker-supported expert surface marker (`common.expert`). */
export function withExpertCommon<T extends ioBroker.StateCommon>(common: T): T {
	return { ...common, expert: true };
}

export function expertStateCommon(
	partial: Omit<ioBroker.StateCommon, "expert"> & Partial<Pick<ioBroker.StateCommon, "expert">>,
): ioBroker.StateCommon {
	return withExpertCommon({ ...partial, expert: true });
}
