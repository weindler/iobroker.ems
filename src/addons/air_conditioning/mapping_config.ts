import type { NativeMappingEntry } from "../../mapping_config";
import {
	AC_MAPPING_ROLES,
	AC_UNIT_COUNT,
	acUnitMappingCommand,
	type AcMappingRole,
} from "./constants";

export function acMappingFlatPrefix(unitIndex: number, role: AcMappingRole): string {
	return `ac_u${unitIndex}_${role}`;
}

export function acMappingFromConfig(config: Record<string, unknown>): Record<string, NativeMappingEntry> {
	const out: Record<string, NativeMappingEntry> = {};
	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		for (const role of AC_MAPPING_ROLES) {
			const prefix = acMappingFlatPrefix(i, role);
			const entry: NativeMappingEntry = {};
			const t = config[`${prefix}_target`];
			if (typeof t === "string" && t.trim()) {
				entry.target_state = t.trim();
			}
			const en = config[`${prefix}_enabled`];
			if (typeof en === "boolean") {
				entry.enabled = en;
			}
			const cmd = acUnitMappingCommand(i, role);
			if (entry.target_state !== undefined || entry.enabled !== undefined) {
				out[cmd] = entry;
			}
		}
	}
	return out;
}

export function acMappingCommands(): string[] {
	const cmds: string[] = [];
	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		for (const role of AC_MAPPING_ROLES) {
			cmds.push(acUnitMappingCommand(i, role));
		}
	}
	return cmds;
}
