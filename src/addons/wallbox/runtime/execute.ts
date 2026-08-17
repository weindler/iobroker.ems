import { buildWallboxCommandCandidate, type WallboxCommandCandidate } from "./command";
import { buildWallboxControlMappingSnapshot, type WallboxControlMappingSnapshot } from "./control_mapping";
import type { WallboxDryrunDispatchResult } from "./dispatch";
import type { WallboxPlanDecision } from "./daily_plan";
import { buildWallboxWritePlan, type WallboxWritePlan } from "./write_plan";
import { buildWallboxFeedbackContract, type WallboxFeedbackContract } from "./feedback";
import { wallboxFeedbackConfigFromAdapter } from "./feedback_config";
import { isRestoreInProgress } from "../../../restore/barrier";
import { writeForeignIfChanged, type DeviceWriteHost } from "../../../device_write";
import { EV_EXECUTION_PHASE5_ENABLED } from "../ev_foundation/write_allowlist";

/**
 * Release-Freigabe für reale Wallbox-/EVCC-Writes — Master-Kill-Switch.
 * v0.1.176: kontrolliert geöffnet, nachdem echte Writes, Feedback-Loop und
 * Safety-Schicht (Fault/Lockout, Ownership, Safe-Restore) verdrahtet sind.
 * Nur der EVCC-Steuerpfad ist live-eligible (`writePlan.liveEligible`); legacy_direct
 * bleibt strukturell dryrun/diagnostisch (siehe control_mapping.ts).
 */
export const WALLBOX_LIVE_WRITE_RELEASED = true;

/**
 * Interne Live-Foundation-Phase für `live_foundation_phase` — kein globaler EMS-Ausführungsmodus.
 * Global/Add-on kennen nur dryrun|live (`execution_mode.ts`); `observe` bedeutet hier „keine Foundation-Ausführung“.
 */
export type WallboxRuntimePhase = "observe" | "dryrun" | "live";

export interface WallboxWriteHost extends DeviceWriteHost {
	log?: Pick<ioBroker.Logger, "info" | "warn" | "error" | "debug">;
}

export interface WallboxOperationWriteResult {
	role: string;
	targetStateId: string;
	written: boolean;
	skipped: boolean;
	required: boolean;
	error: string | null;
}

/**
 * Ergebnis der zentralen Wallbox-Execution.
 * `attempted` / `executed` beziehen sich ausschließlich auf externe Geräte-Writes
 * (EVCC/Wallbox-Fremdstates) — nicht auf den Aufruf dieser Funktion.
 */
export interface WallboxWriteResult {
	/** Externer Geräte-Write wurde ausgelöst. */
	attempted: boolean;
	/** Alle erforderlichen Operationen wurden erfolgreich geschrieben (oder waren bereits am Ziel). */
	executed: boolean;
	blocked: boolean;
	reason: string;
	operationResults: WallboxOperationWriteResult[];
	/** EMS hat aktiv eine Steuer-Operation übernommen — Ownership/Safe-Restore-Pflicht. */
	ownershipGranted: boolean;
	writeTimestampMs: number | null;
}

export interface ExecuteWallboxWriteInput {
	candidate: WallboxCommandCandidate;
	writePlan: WallboxWritePlan | null;
	phase: WallboxRuntimePhase;
	liveRequested: boolean;
	/** Aktiver Fault/Lockout sperrt weitere Live-Writes bis zum expliziten Reset. */
	faultActive?: boolean;
}

function blockedResult(reason: string): WallboxWriteResult {
	return {
		attempted: false,
		executed: false,
		blocked: true,
		reason,
		operationResults: [],
		ownershipGranted: false,
		writeTimestampMs: null,
	};
}

/**
 * EINZIGE zentrale Write-Funktion für Wallbox-/EVCC-Steuerdatenpunkte.
 * Nur der EVCC-Steuerpfad ist live-eligible; legacy_direct bleibt strukturell blockiert.
 */
export async function executeWallboxWrite(
	host: WallboxWriteHost,
	input: ExecuteWallboxWriteInput,
): Promise<WallboxWriteResult> {
	const { candidate, writePlan, phase, liveRequested, faultActive } = input;

	if (isRestoreInProgress()) {
		return blockedResult("restore_in_progress");
	}

	if (phase === "observe") {
		return blockedResult("observe_mode");
	}

	if (phase === "dryrun" || !liveRequested) {
		return blockedResult("execution_gate_closed");
	}

	if (faultActive) {
		return blockedResult("fault_lockout");
	}

	if (candidate.blocked) {
		return blockedResult(candidate.blockReason ?? "candidate_blocked");
	}

	if (!writePlan || !writePlan.contractReady) {
		return blockedResult(writePlan?.blockReason ?? "write_contract_incomplete");
	}

	if (!writePlan.liveEligible) {
		return blockedResult(writePlan.controlPathReason ?? "not_live_eligible");
	}

	if (!WALLBOX_LIVE_WRITE_RELEASED) {
		return blockedResult("release_gate_closed");
	}

	if (writePlan.operations.length === 0) {
		return blockedResult("no_operations");
	}

	const operations = [...writePlan.operations].sort(
		(a, b) => a.sequence - b.sequence || a.role.localeCompare(b.role),
	);
	const operationResults: WallboxOperationWriteResult[] = [];
	let anyWritten = false;
	let requiredFailed = false;

	for (const op of operations) {
		try {
			const r = await writeForeignIfChanged(host, {
				stateId: op.targetStateId,
				value: op.targetValue,
				reason: `wallbox ${writePlan.action}/${op.role}`,
			});
			operationResults.push({
				role: op.role,
				targetStateId: op.targetStateId,
				written: r.written,
				skipped: r.skipped,
				required: op.required,
				error: null,
			});
			if (r.written) anyWritten = true;
		} catch (e) {
			host.log?.error?.(`wallbox write failed ${op.targetStateId}: ${String(e)}`);
			operationResults.push({
				role: op.role,
				targetStateId: op.targetStateId,
				written: false,
				skipped: false,
				required: op.required,
				error: String(e),
			});
			if (op.required) requiredFailed = true;
		}
	}

	if (requiredFailed) {
		return {
			attempted: true,
			executed: false,
			blocked: true,
			reason: "write_failed",
			operationResults,
			ownershipGranted: false,
			writeTimestampMs: null,
		};
	}

	const nowMs = Date.now();
	host.log?.debug?.(
		`wallbox LIVE write ${writePlan.action} (${writePlan.writeScenario ?? "n/a"}) → ${operations.map((o) => o.role).join(",")}`,
	);
	return {
		attempted: true,
		executed: true,
		blocked: false,
		reason: anyWritten ? "executed" : "already_at_target",
		operationResults,
		ownershipGranted: true,
		writeTimestampMs: nowMs,
	};
}

export interface ResolveWallboxRuntimePhaseInput {
	addonEnabled: boolean;
	governanceEnabled: boolean;
	liveRequested: boolean;
	/** Add-on mode=off → observe (EVCC autonom). */
	addonExecutionOff?: boolean;
}

export function resolveWallboxRuntimePhase(input: ResolveWallboxRuntimePhaseInput): WallboxRuntimePhase {
	if (!input.addonEnabled || !input.governanceEnabled) {
		return "observe";
	}
	/** Befund 005: Off = EVCC autonom — keine EMS-Steuerung, kein Dryrun-Dispatch-Write. */
	if (input.addonExecutionOff === true) {
		return "observe";
	}
	if (!input.liveRequested) {
		return "dryrun";
	}
	return "live";
}

export interface WallboxLiveFoundationResult {
	phase: WallboxRuntimePhase;
	liveRequested: boolean;
	/** true wenn Add-on-Modus Aus — Ownership ohne EVCC-Restore freigeben. */
	addonExecutionOff: boolean;
	candidate: WallboxCommandCandidate | null;
	writePlan: WallboxWritePlan | null;
	feedbackContract: WallboxFeedbackContract | null;
	mappingSnapshot: WallboxControlMappingSnapshot;
	writeResult: WallboxWriteResult | null;
	liveWriteReleased: boolean;
	writeAllowed: boolean;
}

export interface RunWallboxLiveFoundationInput {
	dispatch: WallboxDryrunDispatchResult;
	decision: WallboxPlanDecision;
	mappingSnapshot: WallboxControlMappingSnapshot;
	/** Legacy: aktueller Ladefreigabe-Status aus EVCC-Telemetrie (enabled). */
	chargingEnabled: boolean | null;
	/** EVCC: aktueller Modus entspricht konfiguriertem Charge-Mode-Wert. */
	chargeModeActive: boolean | null;
	config: Record<string, unknown>;
	addonEnabled: boolean;
	governanceEnabled: boolean;
	liveRequested: boolean;
	addonExecutionOff?: boolean;
	now: Date;
	/** Aktiver Fault/Lockout — sperrt Live-Writes, unabhängig von Mapping/Plan. */
	faultActive?: boolean;
}

export async function runWallboxLiveFoundation(
	host: WallboxWriteHost,
	input: RunWallboxLiveFoundationInput,
): Promise<WallboxLiveFoundationResult> {
	const addonExecutionOff = input.addonExecutionOff === true;
	const phase = resolveWallboxRuntimePhase({
		addonEnabled: input.addonEnabled,
		governanceEnabled: input.governanceEnabled,
		liveRequested: input.liveRequested,
		addonExecutionOff,
	});

	if (phase === "observe") {
		return {
			phase,
			liveRequested: input.liveRequested,
			addonExecutionOff,
			candidate: null,
			writePlan: null,
			feedbackContract: null,
			mappingSnapshot: input.mappingSnapshot,
			writeResult: null,
			liveWriteReleased: WALLBOX_LIVE_WRITE_RELEASED,
			writeAllowed: false,
		};
	}

	const candidate = buildWallboxCommandCandidate({
		dispatch: input.dispatch,
		decision: input.decision,
		now: input.now,
	});

	const writePlan = buildWallboxWritePlan({
		candidate,
		mapping: input.mappingSnapshot,
		chargingEnabled: input.chargingEnabled,
		chargeModeActive: input.chargeModeActive,
		now: input.now,
	});

	const feedbackConfig = wallboxFeedbackConfigFromAdapter(input.config);
	const feedbackContract = buildWallboxFeedbackContract({
		writePlan,
		feedbackConfig,
		now: input.now,
	});

	let writeResult: WallboxWriteResult | null = null;
	if (phase === "live") {
		if (EV_EXECUTION_PHASE5_ENABLED) {
			writeResult = blockedResult("ev_execution_owns_writes");
		} else {
			writeResult = await executeWallboxWrite(host, {
				candidate,
				writePlan,
				phase,
				liveRequested: input.liveRequested,
				faultActive: input.faultActive,
			});
		}
	}

	return {
		phase,
		liveRequested: input.liveRequested,
		addonExecutionOff,
		candidate,
		writePlan,
		feedbackContract,
		mappingSnapshot: input.mappingSnapshot,
		writeResult,
		liveWriteReleased: WALLBOX_LIVE_WRITE_RELEASED,
		writeAllowed: WALLBOX_LIVE_WRITE_RELEASED && writePlan.liveEligible && phase === "live",
	};
}
