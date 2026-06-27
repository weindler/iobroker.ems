import type { StateHost } from "../../ems_light/state_util";

export async function setStateIfChanged(
	host: StateHost,
	id: string,
	val: ioBroker.StateValue,
): Promise<boolean> {
	const cur = await host.getStateAsync(id);
	const curVal = cur?.val;
	if (curVal === val) {
		return false;
	}
	if (typeof val === "string" && typeof curVal === "string" && val === curVal) {
		return false;
	}
	await host.setStateAsync(id, { val, ack: true });
	return true;
}

export async function setStatesIfRevisionChanged(
	host: StateHost,
	revisionStateId: string,
	newRevision: string,
	writes: Array<{ id: string; val: ioBroker.StateValue }>,
	updatedAtId: string,
	updatedAt: string,
): Promise<{ changed: boolean; writes: number }> {
	const curRev = await host.getStateAsync(revisionStateId);
	const prevRevision = curRev?.val != null ? String(curRev.val) : "";
	const revisionChanged = prevRevision !== newRevision;

	if (!revisionChanged) {
		return { changed: false, writes: 0 };
	}

	let writeCount = 0;
	for (const w of writes) {
		if (await setStateIfChanged(host, w.id, w.val)) {
			writeCount++;
		}
	}
	await setStateIfChanged(host, revisionStateId, newRevision);
	await setStateIfChanged(host, updatedAtId, updatedAt);
	return { changed: true, writes: writeCount };
}
