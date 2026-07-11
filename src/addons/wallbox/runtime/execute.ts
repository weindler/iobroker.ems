import { buildWallboxCommandCandidate, type WallboxCommandCandidate } from "./command";
import { buildWallboxControlMappingSnapshot, type WallboxControlMappingSnapshot } from "./control_mapping";
import type { WallboxDryrunDispatchResult } from "./dispatch";
import type { WallboxPlanDecision } from "./daily_plan";
import { buildWallboxWritePlan, type WallboxWritePlan } from "./write_plan";

/** Release-Freigabe für reale Wallbox-/EVCC-Writes — in v0.1.135 geschlossen. */
export const WALLBOX_LIVE_WRITE_RELEASED = false;

/**
 * Interne Live-Foundation-Phase für `live_foundation_phase` — kein globaler EMS-Ausführungsmodus.
 * Global/Add-on kennen nur dryrun|live (`execution_mode.ts`); `observe` bedeutet hier „keine Foundation-Ausführung“.
 */
export type WallboxRuntimePhase = "observe" | "dryrun" | "live";

/**
 * Ergebnis der zentralen Wallbox-Execution.
 * `attempted` / `executed` beziehen sich ausschließlich auf externe Geräte-Writes
 * (EVCC/Wallbox-Fremdstates) — nicht auf den Aufruf dieser Funktion.
 */
export interface WallboxWriteResult {
	/** Externer Geräte-Write wurde ausgelöst (false solange Release-Gate geschlossen). */
	attempted: boolean;
	/** Externer Geräte-Write wurde erfolgreich gesendet. */
	executed: boolean;
	blocked: boolean;
	reason: string;
}

export interface ExecuteWallboxWriteInput {
	candidate: WallboxCommandCandidate;
	writePlan: WallboxWritePlan | null;
	phase: WallboxRuntimePhase;
	liveRequested: boolean;
}

/**
 * EINZIGE zentrale Write-Funktion für Wallbox-/EVCC-Steuerdatenpunkte.
 * In v0.1.135 werden keine externen Writes ausgeführt — Release-Gate geschlossen.
 */
export async function executeWallboxWrite(input: ExecuteWallboxWriteInput): Promise<WallboxWriteResult> {
	const { candidate, writePlan, phase, liveRequested } = input;

	if (phase === "observe") {
		return {
			attempted: false,
			executed: false,
			blocked: true,
			reason: "observe_mode",
		};
	}

	if (phase === "dryrun" || !liveRequested) {
		return {
			attempted: false,
			executed: false,
			blocked: true,
			reason: "execution_gate_closed",
		};
	}

	if (candidate.blocked) {
		return {
			attempted: false,
			executed: false,
			blocked: true,
			reason: candidate.blockReason ?? "candidate_blocked",
		};
	}

	if (writePlan && !writePlan.contractReady) {
		return {
			attempted: false,
			executed: false,
			blocked: true,
			reason: writePlan.blockReason ?? "write_contract_incomplete",
		};
	}

	if (!WALLBOX_LIVE_WRITE_RELEASED) {
		return {
			attempted: false,
			executed: false,
			blocked: true,
			reason: "release_gate_closed",
		};
	}

	// Zukünftiger Live-Block: Write-Plan-Operationen ausführen.
	return {
		attempted: false,
		executed: false,
		blocked: true,
		reason: "release_gate_closed",
	};
}

export interface ResolveWallboxRuntimePhaseInput {
	addonEnabled: boolean;
	governanceEnabled: boolean;
	liveRequested: boolean;
}

export function resolveWallboxRuntimePhase(input: ResolveWallboxRuntimePhaseInput): WallboxRuntimePhase {
	if (!input.addonEnabled || !input.governanceEnabled) {
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
	candidate: WallboxCommandCandidate | null;
	writePlan: WallboxWritePlan | null;
	mappingSnapshot: WallboxControlMappingSnapshot;
	writeResult: WallboxWriteResult | null;
	liveWriteReleased: false;
	writeAllowed: false;
}

export interface RunWallboxLiveFoundationInput {
	dispatch: WallboxDryrunDispatchResult;
	decision: WallboxPlanDecision;
	mappingSnapshot: WallboxControlMappingSnapshot;
	/** Legacy: aktueller Ladefreigabe-Status aus EVCC-Telemetrie (enabled). */
	chargingEnabled: boolean | null;
	/** EVCC: aktueller Modus entspricht konfiguriertem Charge-Mode-Wert. */
	chargeModeActive: boolean | null;
	addonEnabled: boolean;
	governanceEnabled: boolean;
	liveRequested: boolean;
	now: Date;
}

export async function runWallboxLiveFoundation(
	input: RunWallboxLiveFoundationInput,
): Promise<WallboxLiveFoundationResult> {
	const phase = resolveWallboxRuntimePhase({
		addonEnabled: input.addonEnabled,
		governanceEnabled: input.governanceEnabled,
		liveRequested: input.liveRequested,
	});

	if (phase === "observe") {
		return {
			phase,
			liveRequested: input.liveRequested,
			candidate: null,
			writePlan: null,
			mappingSnapshot: input.mappingSnapshot,
			writeResult: null,
			liveWriteReleased: false,
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

	let writeResult: WallboxWriteResult | null = null;
	if (phase === "live") {
		writeResult = await executeWallboxWrite({
			candidate,
			writePlan,
			phase,
			liveRequested: input.liveRequested,
		});
	}

	return {
		phase,
		liveRequested: input.liveRequested,
		candidate,
		writePlan,
		mappingSnapshot: input.mappingSnapshot,
		writeResult,
		liveWriteReleased: false,
		writeAllowed: false,
	};
}
