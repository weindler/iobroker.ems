import { writeForeignIfChanged, type DeviceWriteHost } from "../../../device_write";
import { mappingBase } from "../../../tree_paths";
import {
	AC_ADDON_ID,
	acUnitMappingCommand,
	AC_TOGGLE_STATE_RESET_MS,
	type AcMappingRole,
} from "../constants";
import { acMappingFromConfig } from "../mapping_config";
import type { AcWriteStep } from "../profiles/types";

export type AcMappingTable = Partial<Record<string, { enabled: boolean; targetStateId: string }>>;

const SAMSUNG_TOGGLE_ROLES: AcMappingRole[] = ["cmd_switch_on", "cmd_switch_off", "cmd_refresh"];

/** Nach switch-off auch switch-on zurücksetzen (und umgekehrt) — hängen sonst auf ON. */
const TOGGLE_CROSS_RESET: Partial<Record<AcMappingRole, AcMappingRole[]>> = {
	cmd_switch_on: ["cmd_switch_off"],
	cmd_switch_off: ["cmd_switch_on"],
};

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

export function collectToggleMirrorIds(table: AcMappingTable, unitIndex: number): string[] {
	return SAMSUNG_TOGGLE_ROLES.map((role) => resolveAcMappingTarget(table, unitIndex, role)).filter(
		(id) => id.length > 0,
	);
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

function uniqueStateIds(stateIds: string[]): string[] {
	return [...new Set(stateIds.map((id) => id.trim()).filter(Boolean))];
}

/** Nur ioBroker-Spiegel — kein SmartThings-Befehl (ack:true). */
export async function resetToggleMirrorsNow(
	host: DeviceWriteHost,
	stateIds: string[],
	log?: { info?: (m: string) => void; debug?: (m: string) => void },
): Promise<void> {
	for (const stateId of uniqueStateIds(stateIds)) {
		try {
			await host.setForeignStateAsync(stateId, { val: false, ack: true });
			log?.debug?.(`ac toggle mirror reset now: ${stateId} → false`);
		} catch {
			// best-effort
		}
	}
}

/** Verzögert nach Sequenzende — SmartThings-Adapter überschreibt oft kurz nach refresh. */
export function scheduleToggleMirrorReset(
	host: DeviceWriteHost,
	stateIds: string[],
	delayMs = AC_TOGGLE_STATE_RESET_MS,
	log?: { info?: (m: string) => void; debug?: (m: string) => void },
): void {
	const unique = uniqueStateIds(stateIds);
	if (unique.length === 0) {
		return;
	}
	setTimeout(() => {
		void resetToggleMirrorsNow(host, unique, log).then(() => {
			log?.info?.(
				`ac toggle mirror reset (${Math.round(delayMs / 1000)}s after sequence): ${unique.length} state(s) → false`,
			);
		});
	}, delayMs);
}

async function pulseSmartThingsToggle(
	host: DeviceWriteHost,
	unitIndex: number,
	table: AcMappingTable,
	role: AcMappingRole,
	stateId: string,
	log?: { info?: (m: string) => void; debug?: (m: string) => void },
): Promise<void> {
	const resetIds = [stateId];
	for (const crossRole of TOGGLE_CROSS_RESET[role] ?? []) {
		const crossId = resolveAcMappingTarget(table, unitIndex, crossRole);
		if (crossId) {
			resetIds.push(crossId);
		}
	}
	await resetToggleMirrorsNow(host, resetIds, log);
	await writeForeignIfChanged(host, {
		stateId,
		value: true,
		reason: `ac unit ${unitIndex} ${role}`,
		force: true,
	});
}

export async function executeAcWriteSteps(
	host: DeviceWriteHost,
	unitIndex: number,
	table: AcMappingTable,
	steps: AcWriteStep[],
	live: boolean,
	log?: { info?: (m: string) => void; debug?: (m: string) => void },
): Promise<void> {
	let usedLiveToggle = false;
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
			usedLiveToggle = true;
			await pulseSmartThingsToggle(host, unitIndex, table, role, stateId, log);
			continue;
		}
		await writeForeignIfChanged(host, {
			stateId,
			value: step.value,
			reason: `ac unit ${unitIndex} ${role}`,
		});
	}

	if (live && usedLiveToggle) {
		const toggleIds = collectToggleMirrorIds(table, unitIndex);
		// Nach refresh oft erneut ON — zweimal zurücksetzen (10 s + 25 s nach Sequenzende).
		scheduleToggleMirrorReset(host, toggleIds, AC_TOGGLE_STATE_RESET_MS, log);
		scheduleToggleMirrorReset(host, toggleIds, AC_TOGGLE_STATE_RESET_MS * 2 + 5_000, log);
	}
}
