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

async function pulseSmartThingsToggle(
	host: DeviceWriteHost,
	unitIndex: number,
	role: AcMappingRole,
	stateId: string,
): Promise<void> {
	// Impuls-States hängen oft auf true — ioBroker-Spiegel zurück (ack:true, kein Gerätebefehl),
	// damit der folgende ack:false-Impuls beim SmartThings-Adapter ankommt.
	try {
		await host.setForeignStateAsync(stateId, { val: false, ack: true });
	} catch {
		// best-effort
	}
	await writeForeignIfChanged(host, {
		stateId,
		value: true,
		reason: `ac unit ${unitIndex} ${role}`,
		force: true,
	});
}

/**
 * Ausschalten (wie v0.1.163 — vor dem Multi-Target-Schreiben in v0.1.165):
 * - Dedizierter Off-Befehl (≠ On, ≠ Feedback) → nur boolean-Impuls auf Off.
 *   SmartThings `switch off` nimmt keine Argumente; Schreiben von "off"/false auf on/status → 422.
 * - Gemeinsamer Switch → einmal typgerechten Off-Wert setzen (boolean false oder "off").
 * Feedback-Status allein ist nie ein Schreibziel.
 */
export async function writeAcUnitSwitchOff(
	host: DeviceWriteHost,
	unitIndex: number,
	table: AcMappingTable,
	live: boolean,
	log?: { info?: (m: string) => void; debug?: (m: string) => void; warn?: (m: string) => void },
): Promise<{ attempted: boolean; mode: "pulse" | "set_off" | "none"; targets: string[] }> {
	const offId = resolveAcMappingTarget(table, unitIndex, "cmd_switch_off");
	const onId = resolveAcMappingTarget(table, unitIndex, "cmd_switch_on");
	const fbId = resolveAcMappingTarget(table, unitIndex, "feedback_switch");
	const dedicatedOffButton = Boolean(offId && offId !== onId && offId !== fbId);

	if (dedicatedOffButton) {
		if (!live) {
			log?.debug?.(`ac dryrun unit ${unitIndex}: switch_off pulse → ${offId}`);
			return { attempted: true, mode: "pulse", targets: [offId] };
		}
		log?.info?.(`ac unit ${unitIndex}: switch_off pulse → ${offId}`);
		await pulseSmartThingsToggle(host, unitIndex, "cmd_switch_off", offId);
		return { attempted: true, mode: "pulse", targets: [offId] };
	}

	// Gemeinsamer Schalter: On/Off (ggf. = Feedback) — Status allein nicht beschreiben.
	const targetId = offId || onId;
	if (!targetId) {
		log?.warn?.(`ac unit ${unitIndex}: stop skipped — kein switch_off/on gemappt (Feedback allein nicht schreibbar)`);
		return { attempted: false, mode: "none", targets: [] };
	}

	if (!live) {
		log?.debug?.(`ac dryrun unit ${unitIndex}: switch_off set → ${targetId}`);
		return { attempted: true, mode: "set_off", targets: [targetId] };
	}

	let current: unknown = null;
	try {
		const st = await host.getForeignStateAsync(targetId);
		current = st?.val ?? null;
	} catch {
		current = null;
	}
	const offValue: string | boolean =
		typeof current === "boolean" || current === 0 || current === 1 ? false : "off";

	log?.info?.(`ac unit ${unitIndex}: switch_off set ${JSON.stringify(offValue)} → ${targetId}`);
	await writeForeignIfChanged(host, {
		stateId: targetId,
		value: offValue,
		reason: `ac unit ${unitIndex} switch_off`,
		force: true,
	});
	return { attempted: true, mode: "set_off", targets: [targetId] };
}

export async function executeAcWriteSteps(
	host: DeviceWriteHost,
	unitIndex: number,
	table: AcMappingTable,
	steps: AcWriteStep[],
	live: boolean,
	log?: { info?: (m: string) => void; debug?: (m: string) => void; warn?: (m: string) => void },
): Promise<void> {
	for (const step of steps) {
		if (step.kind === "delay_ms") {
			if (live) {
				await sleep(step.ms);
			}
			continue;
		}
		if (step.kind === "switch_off") {
			await writeAcUnitSwitchOff(host, unitIndex, table, live, log);
			continue;
		}
		const role = step.role;
		const stateId = resolveAcMappingTarget(table, unitIndex, role);
		if (!stateId) {
			log?.debug?.(`ac unit ${unitIndex}: skip unmapped role ${role}`);
			continue;
		}
		if (!live) {
			if (step.kind === "set_json") {
				log?.debug?.(
					`ac dryrun unit ${unitIndex}: set_json ${role} ${JSON.stringify(step.payload)} → ${stateId}`,
				);
			} else {
				log?.debug?.(`ac dryrun unit ${unitIndex}: ${step.kind} ${role} → ${stateId}`);
			}
			continue;
		}
		if (step.kind === "toggle") {
			await pulseSmartThingsToggle(host, unitIndex, role, stateId);
			continue;
		}
		if (step.kind === "set_json") {
			const json = JSON.stringify(step.payload);
			await writeForeignIfChanged(host, {
				stateId,
				value: json,
				reason: `ac unit ${unitIndex} ${role} json`,
				force: true,
			});
			continue;
		}
		await writeForeignIfChanged(host, {
			stateId,
			value: step.value,
			reason: `ac unit ${unitIndex} ${role}`,
		});
	}
}
