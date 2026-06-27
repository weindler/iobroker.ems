/** Hilfen zum Anlegen von States (nur setObjectNotExists, Defaults nur wenn leer). */

export type StateHost = {
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	extendObjectAsync?: (id: string, obj: Partial<ioBroker.Object>) => Promise<unknown>;
};

export async function ensureChannel(
	host: StateHost,
	channelId: string,
	nameDe: string,
): Promise<void> {
	await host.setObjectNotExistsAsync(channelId, {
		type: "channel",
		common: { name: nameDe },
		native: {},
	} as ioBroker.Object);
}

export type StateDef = {
	id: string;
	common: ioBroker.StateCommon;
	defaultVal?: ioBroker.StateValue;
	/** Default nur setzen wenn State noch nie beschrieben (val undefined/null/""). */
	setDefaultIfEmpty?: boolean;
	/** Wert bei jedem ensureStates-Lauf setzen (z. B. Adapter-Version). */
	alwaysUpdate?: boolean;
	/** common auch bei bereits existierenden Objekten aktualisieren (z. B. states/role). */
	extendCommon?: boolean;
};

export async function ensureStates(host: StateHost, defs: StateDef[]): Promise<void> {
	for (const def of defs) {
		await host.setObjectNotExistsAsync(def.id, {
			type: "state",
			common: def.common,
			native: {},
		} as ioBroker.Object);
		if (def.extendCommon && typeof host.extendObjectAsync === "function") {
			await host.extendObjectAsync(def.id, { common: def.common } as Partial<ioBroker.Object>);
		}
		if (def.alwaysUpdate && def.defaultVal !== undefined) {
			await host.setStateAsync(def.id, { val: def.defaultVal, ack: true });
			continue;
		}
		if (def.defaultVal === undefined || def.setDefaultIfEmpty === false) {
			continue;
		}
		const cur = await host.getStateAsync(def.id);
		if (cur?.val === undefined || cur.val === null || cur.val === "") {
			await host.setStateAsync(def.id, { val: def.defaultVal, ack: true });
		}
	}
}

export function asNum(v: unknown): number | null {
	if (v === null || v === undefined || v === "" || typeof v === "boolean") {
		return null;
	}
	const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
	return Number.isFinite(n) ? n : null;
}

export function asBool(v: unknown): boolean | null {
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	const s = String(v ?? "").trim().toLowerCase();
	if (["1", "true", "on", "yes", "ja"].includes(s)) return true;
	if (["0", "false", "off", "no", "nein"].includes(s)) return false;
	return null;
}
