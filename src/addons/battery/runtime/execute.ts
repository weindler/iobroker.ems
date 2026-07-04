import type { BatteryProfileId } from "../core/types";
import { writeForeignIfChanged, type DeviceWriteHost } from "../../../device_write";

export type BatteryWriteKind = "operating_mode" | "charge_power";

export interface BatteryWriteHost extends DeviceWriteHost {
	log: Pick<ioBroker.Logger, "info" | "warn" | "error" | "debug">;
}

/** Bedingungen, die unmittelbar vor jedem realen Write erneut geprüft werden. */
export interface FinalWriteGate {
	globalLive: boolean;
	governanceEnabled: boolean;
	profileId: BatteryProfileId;
	profileLiveControlAvailable: boolean;
	profileReady: boolean;
	intentValid: boolean;
	telemetryReady: boolean;
	fault: boolean;
	lockout: boolean;
	targetMappingConfigured: boolean;
	ownershipValid: boolean;
}

export interface FinalGateResult {
	passed: boolean;
	rejectCode: string | null;
}

export function evaluateFinalWriteGate(gate: FinalWriteGate): FinalGateResult {
	if (!gate.globalLive) return { passed: false, rejectCode: "execution_gate_closed" };
	if (!gate.governanceEnabled) return { passed: false, rejectCode: "addon_disabled" };
	if (gate.profileId !== "sonnen_em") return { passed: false, rejectCode: "profile_not_live_capable" };
	if (!gate.profileLiveControlAvailable) return { passed: false, rejectCode: "live_control_unavailable" };
	if (!gate.profileReady) return { passed: false, rejectCode: "profile_not_ready" };
	if (!gate.intentValid) return { passed: false, rejectCode: "intent_invalid" };
	if (!gate.telemetryReady) return { passed: false, rejectCode: "telemetry_stale" };
	if (gate.fault) return { passed: false, rejectCode: "fault" };
	if (gate.lockout) return { passed: false, rejectCode: "lockout" };
	if (!gate.targetMappingConfigured) return { passed: false, rejectCode: "missing_mapping" };
	if (!gate.ownershipValid) return { passed: false, rejectCode: "ownership_invalid" };
	return { passed: true, rejectCode: null };
}

export interface ExecuteBatteryWriteParams {
	kind: BatteryWriteKind;
	stateId: string;
	value: number;
	requestId: string;
	reason: string;
	expectedFeedback?: number | null;
	/** true = globaler Modus != live → niemals real schreiben. */
	dryrun: boolean;
	gate: FinalWriteGate;
	numericTolerance?: number;
}

export interface BatteryWriteResult {
	kind: BatteryWriteKind;
	stateId: string;
	value: number;
	executed: boolean;
	/** Geräte-Write tatsächlich gesendet (false wenn skipped). */
	written: boolean;
	/** Zielwert war bereits aktiv — kein Write nötig. */
	skipped: boolean;
	simulated: boolean;
	gatePassed: boolean;
	rejectCode: string | null;
	at: string;
	expectedFeedback: number | null;
}

/**
 * EINZIGE zentrale Write-Funktion für reale Batterie-Datenpunkte.
 * Dryrun simuliert exakt denselben Ablauf wie Live, schreibt aber nie real.
 */
export async function executeBatteryWrite(
	host: BatteryWriteHost,
	params: ExecuteBatteryWriteParams,
): Promise<BatteryWriteResult> {
	const at = new Date().toISOString();
	const base: Omit<BatteryWriteResult, "executed" | "written" | "skipped" | "simulated" | "gatePassed" | "rejectCode"> = {
		kind: params.kind,
		stateId: params.stateId,
		value: params.value,
		at,
		expectedFeedback: params.expectedFeedback ?? null,
	};

	if (params.dryrun) {
		host.log.debug(
			`battery dryrun would_write ${params.kind}=${params.value} → ${params.stateId} (${params.reason})`,
		);
		return {
			...base,
			executed: false,
			written: false,
			skipped: false,
			simulated: true,
			gatePassed: true,
			rejectCode: null,
		};
	}

	const gate = evaluateFinalWriteGate(params.gate);
	if (!gate.passed) {
		host.log.warn(
			`battery write blocked (${gate.rejectCode}) ${params.kind}=${params.value} → ${params.stateId}`,
		);
		return {
			...base,
			executed: false,
			written: false,
			skipped: false,
			simulated: false,
			gatePassed: false,
			rejectCode: gate.rejectCode,
		};
	}

	if (!params.stateId) {
		return {
			...base,
			executed: false,
			written: false,
			skipped: false,
			simulated: false,
			gatePassed: false,
			rejectCode: "missing_mapping",
		};
	}

	try {
		const writeResult = await writeForeignIfChanged(host, {
			stateId: params.stateId,
			value: params.value,
			reason: `battery ${params.kind}: ${params.reason}`,
			numericTolerance: params.numericTolerance ?? 0,
		});
		if (writeResult.skipped) {
			host.log.info(
				`battery write skipped (already at target) ${params.kind}=${params.value} → ${params.stateId} (${params.reason})`,
			);
			return {
				...base,
				executed: true,
				written: false,
				skipped: true,
				simulated: false,
				gatePassed: true,
				rejectCode: null,
			};
		}
		host.log.info(`battery LIVE write ${params.kind}=${params.value} → ${params.stateId} (${params.reason})`);
		return {
			...base,
			executed: true,
			written: true,
			skipped: false,
			simulated: false,
			gatePassed: true,
			rejectCode: null,
		};
	} catch (e) {
		host.log.error(`battery write failed ${params.stateId}: ${String(e)}`);
		return {
			...base,
			executed: false,
			written: false,
			skipped: false,
			simulated: false,
			gatePassed: true,
			rejectCode: params.kind === "operating_mode" ? "mode_write_failed" : "charge_write_failed",
		};
	}
}
