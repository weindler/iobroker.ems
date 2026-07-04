import { writeForeignIfChanged, type DeviceWriteHost } from "../../../device_write";
import { mappingBase } from "../../../tree_paths";
import { AC_ADDON_ID, acUnitMappingCommand, type AcMappingRole } from "../constants";
import { acMappingFromConfig } from "../mapping_config";
import type { AcWriteStep } from "../profiles/types";

export type AcMappingTable = Partial<Record<string, { enabled: boolean; targetStateId: string }>>;

export function resolveAcMappingTarget(
	table: AcMappingTable,
	unitIndex: number,
	role: AcMappingRole,
): string {
	const cmd = acUnitMappingCommand(unitIndex, role);
	const entry = table[cmd];
	if (!entry?.enabled || !entry.targetStateId.trim()) {
		return "";
	}
	return entry.targetStateId.trim();
}

export function buildAcMappingTableFromConfig(config: Record<string, unknown>): AcMappingTable {
	const entries = acMappingFromConfig(config);
	const table: AcMappingTable = {};
	for (const [cmd, entry] of Object.entries(entries)) {
		table[cmd] = {
			enabled: entry.enabled !== false,
			targetStateId: entry.target_state ?? "",
		};
	}
	return table;
}

export async function buildAcMappingTableFromStates(
	host: { getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined> },
	unitIndex: number,
	roles: AcMappingRole[],
): Promise<AcMappingTable> {
	const table: AcMappingTable = {};
	for (const role of roles) {
		const cmd = acUnitMappingCommand(unitIndex, role);
		const base = mappingBase(AC_ADDON_ID, cmd);
		const enabledSt = await host.getStateAsync(`${base}.enabled`);
		const targetSt = await host.getStateAsync(`${base}.target_state`);
		table[cmd] = {
			enabled: enabledSt?.val !== false,
			targetStateId: typeof targetSt?.val === "string" ? targetSt.val.trim() : "",
		};
	}
	return table;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeAcWriteSteps(
	host: DeviceWriteHost,
	unitIndex: number,
	table: AcMappingTable,
	steps: AcWriteStep[],
	live: boolean,
	log?: { info?: (m: string) => void; debug?: (m: string) => void },
): Promise<void> {
	for (const step of steps) {
		if (step.kind === "delay_ms") {
			if (live) {
				await sleep(step.ms);
			}
			continue;
		}
		const role = step.role;
		const stateId = resolveAcMappingTarget(table, unitIndex, role);
		if (!stateId) {
			log?.debug?.(`ac unit ${unitIndex}: skip unmapped role ${role}`);
			continue;
		}
		if (!live) {
			log?.info?.(`ac dryrun unit ${unitIndex}: ${step.kind} ${role} → ${stateId}`);
			continue;
		}
		if (step.kind === "toggle") {
			await writeForeignIfChanged(host, { stateId, value: true, reason: `ac unit ${unitIndex} ${role}` });
			continue;
		}
		await writeForeignIfChanged(host, {
			stateId,
			value: step.value,
			reason: `ac unit ${unitIndex} ${role}`,
		});
	}
}
