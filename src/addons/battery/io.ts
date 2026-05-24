import type { BatteryTickHost } from "./grid_balance_runner";

const ADDON_ID = "battery";

export async function readBool(adapter: BatteryTickHost, relativeId: string): Promise<boolean> {
	const st = await adapter.getStateAsync(relativeId);
	return st?.val === true;
}

export async function readNumber(adapter: BatteryTickHost, relativeId: string): Promise<number | null> {
	const st = await adapter.getStateAsync(relativeId);
	if (st?.val == null) return null;
	const n = Number(st.val);
	return Number.isFinite(n) ? n : null;
}

export async function readForeignNumber(adapter: BatteryTickHost, stateId: string): Promise<number | null> {
	const id = stateId?.trim();
	if (!id) return null;
	try {
		const st = await adapter.getForeignStateAsync(id);
		if (st?.val == null) return null;
		const n = Number(st.val);
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
}

export async function mappedTargetId(
	adapter: BatteryTickHost,
	role: string,
): Promise<{ enabled: boolean; targetId: string }> {
	const base = `mapping.${ADDON_ID}.${role}`;
	const en = await adapter.getStateAsync(`${base}.enabled`);
	if (en?.val === false) {
		return { enabled: false, targetId: "" };
	}
	const ts = await adapter.getStateAsync(`${base}.target_state`);
	const targetId = typeof ts?.val === "string" ? ts.val.trim() : "";
	return { enabled: true, targetId };
}

export async function readMappedRole(adapter: BatteryTickHost, role: string): Promise<number | null> {
	const { enabled, targetId } = await mappedTargetId(adapter, role);
	if (!enabled || !targetId) return null;
	return readForeignNumber(adapter, targetId);
}

export async function writeForeignIfLive(
	adapter: BatteryTickHost,
	stateId: string,
	value: ioBroker.StateValue,
	liveEnabled: boolean,
): Promise<boolean> {
	if (!stateId?.trim() || !liveEnabled) return false;
	await adapter.setForeignStateAsync(stateId.trim(), { val: value, ack: true });
	return true;
}
