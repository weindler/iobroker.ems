/**
 * When an AC unit slot gets state-tree objects.
 * Slots 1..AC_UNIT_COUNT remain Admin UI capacity — only enabled units get objects.
 */
import {
	AC_MAPPING_ROLES,
	AC_UNIT_COUNT,
	acMappingFlatPrefix,
	acUnitMappingCommand,
} from "./constants";
import { acUnitConfigFromAdapter } from "./config";

function configRecord(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

/** True if any mapping role has a non-empty target_state in native config. */
export function acUnitHasMappingTarget(config: unknown, index: number): boolean {
	const c = configRecord(config);
	for (const role of AC_MAPPING_ROLES) {
		const t = c[`${acMappingFlatPrefix(index, role)}_target`];
		if (typeof t === "string" && t.trim().length > 0) {
			return true;
		}
	}
	return false;
}

/**
 * Configured for ensure/cleanup = Unit in Admin aktiviert (`ac_uN_enabled`).
 * Nur aktivierte Units bekommen Runtime-/Mapping-States.
 */
export function isAcUnitConfigured(config: unknown, index: number): boolean {
	if (!Number.isInteger(index) || index < 1 || index > AC_UNIT_COUNT) {
		return false;
	}
	return acUnitConfigFromAdapter(config, index).enabled === true;
}

export function configuredAcUnitIndexes(config: unknown): number[] {
	const out: number[] = [];
	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		if (isAcUnitConfigured(config, i)) {
			out.push(i);
		}
	}
	return out;
}

export function acMappingCommandsForConfiguredUnits(config: unknown): string[] {
	const cmds: string[] = [];
	for (const i of configuredAcUnitIndexes(config)) {
		for (const role of AC_MAPPING_ROLES) {
			cmds.push(acUnitMappingCommand(i, role));
		}
	}
	return cmds;
}
