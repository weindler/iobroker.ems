/** Read-before-write: kein Geräte-Write wenn Zielwert bereits aktiv ist. */

import { assertDeviceActionAllowed } from "./restore/barrier";

export interface DeviceWriteHost {
	getForeignStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setForeignStateAsync: (
		id: string,
		state: ioBroker.SettableState | ioBroker.StateValue,
	) => Promise<unknown>;
	log?: Pick<ioBroker.Logger, "info" | "warn" | "error" | "debug">;
}

export interface DeviceValueMatchOptions {
	numericTolerance?: number;
}

export function normalizeDeviceValue(val: unknown): unknown {
	if (val === null || val === undefined || val === "") {
		return null;
	}
	if (typeof val === "boolean" || typeof val === "number") {
		return val;
	}
	if (typeof val === "string") {
		const s = val.trim().toLowerCase();
		if (["true", "1", "on", "yes", "ja"].includes(s)) {
			return true;
		}
		if (["false", "0", "off", "no", "nein"].includes(s)) {
			return false;
		}
		const n = parseFloat(val.replace(",", "."));
		if (Number.isFinite(n)) {
			return n;
		}
		return val.trim();
	}
	return val;
}

export function deviceValuesMatch(
	current: unknown,
	requested: ioBroker.StateValue,
	options: DeviceValueMatchOptions = {},
): boolean {
	const cur = normalizeDeviceValue(current);
	const req = normalizeDeviceValue(requested);
	if (cur === req) {
		return true;
	}
	if (cur === null || req === null) {
		return false;
	}
	if (typeof cur === "number" && typeof req === "number") {
		const tol = options.numericTolerance ?? 0;
		return Math.abs(cur - req) <= tol;
	}
	if (typeof cur === "boolean" && typeof req === "boolean") {
		return cur === req;
	}
	if (typeof cur === "boolean" && typeof req === "number") {
		return (cur && req !== 0) || (!cur && req === 0);
	}
	if (typeof cur === "number" && typeof req === "boolean") {
		return (req && cur !== 0) || (!req && cur === 0);
	}
	return String(cur) === String(req);
}

export interface WriteForeignIfChangedParams {
	stateId: string;
	value: ioBroker.StateValue;
	reason: string;
	numericTolerance?: number;
	/** true = immer schreiben (z. B. erzwungener Retry) */
	force?: boolean;
}

export interface WriteForeignIfChangedResult {
	written: boolean;
	skipped: boolean;
	currentValue: unknown;
}

/**
 * Liest den aktuellen Geräte-State und schreibt nur bei Abweichung.
 * skipped=true bedeutet: Ziel bereits erreicht, kein Bus-Traffic nötig.
 */
export async function writeForeignIfChanged(
	host: DeviceWriteHost,
	params: WriteForeignIfChangedParams,
): Promise<WriteForeignIfChangedResult> {
	const gate = assertDeviceActionAllowed();
	if (!gate.ok) {
		return { written: false, skipped: true, currentValue: null };
	}
	if (!params.stateId.trim()) {
		return { written: false, skipped: false, currentValue: null };
	}

	let current: unknown = null;
	if (!params.force) {
		try {
			const st = await host.getForeignStateAsync(params.stateId);
			current = st?.val ?? null;
			if (deviceValuesMatch(current, params.value, { numericTolerance: params.numericTolerance })) {
				host.log?.debug?.(
					`device write skipped (already at target) ${params.stateId}=${String(params.value)} (${params.reason})`,
				);
				return { written: false, skipped: true, currentValue: current };
			}
		} catch {
			// Lesefehler — Write-Versuch trotzdem (Gerät evtl. offline)
		}
	}

	await host.setForeignStateAsync(params.stateId, { val: params.value, ack: false });
	return { written: true, skipped: false, currentValue: current };
}
