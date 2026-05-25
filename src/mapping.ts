import type { PipelineContext } from "./pipeline";
import { mappingBase } from "./tree_paths";

export interface MappingConfig {
	mappingId: string;
	enabled: boolean;
	targetState: string;
	allowedValues: unknown[] | null;
}

export async function loadMapping(
	ctx: PipelineContext,
	addonId: string,
	mappingId: string,
): Promise<MappingConfig | null> {
	const base = mappingBase(addonId, mappingId);
	const enabledState = await ctx.getState(`${base}.enabled`);
	const targetState = await ctx.getState(`${base}.target_state`);
	if (!targetState?.val || String(targetState.val).trim() === "") {
		return null;
	}
	const allowed = await ctx.getState(`${base}.allowed_values`);
	return {
		mappingId,
		enabled: enabledState?.val !== false,
		targetState: String(targetState.val).trim(),
		allowedValues: parseAllowedValues(allowed?.val),
	};
}

function parseAllowedValues(val: unknown): unknown[] | null {
	if (val === null || val === undefined || val === "") return null;
	if (Array.isArray(val)) return val;
	if (typeof val === "string") {
		const s = val.trim();
		if (!s) return null;
		try {
			const parsed = JSON.parse(s) as unknown;
			if (Array.isArray(parsed)) return parsed;
		} catch {
			// fall through
		}
		return s.split(",").map((x) => x.trim());
	}
	return null;
}

/** Map logical value for dryrun display (e.g. W → A for go-e ampere). */
export function resolvePlannedValue(
	command: string,
	value: unknown,
	targetState: string,
): unknown {
	if (command === "set_charge_power_w" && typeof value === "number") {
		const amps = Math.round(value / 230);
		return { watts: value, ampere: Math.max(0, amps), target_state: targetState };
	}
	return value;
}

export function isValueAllowed(value: unknown, allowed: unknown[] | null): boolean {
	if (!allowed?.length) return true;
	return allowed.some((a) => valuesEqual(a, value));
}

function valuesEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a === "number" && typeof b === "number") return a === b;
	return String(a) === String(b);
}
