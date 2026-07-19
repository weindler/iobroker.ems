/** Startup live-rearm gate — independent from restore dryrun context. */

let startupRearmRequired = false;
let bootstrapCompletedAtMs = 0;
const executionModeBaselineLc = new Map<string, number>();

export function setStartupRearmRequired(required: boolean): void {
	startupRearmRequired = required;
}

export function isStartupRearmRequired(): boolean {
	return startupRearmRequired;
}

export function markBootstrapCompletedForRearm(nowMs = Date.now()): void {
	bootstrapCompletedAtMs = nowMs;
}

export function getBootstrapCompletedAtMs(): number {
	return bootstrapCompletedAtMs;
}

export function recordExecutionModeBaseline(relativeStateId: string, lc: number): void {
	executionModeBaselineLc.set(relativeStateId, lc);
}

export function clearExecutionModeBaseline(): void {
	executionModeBaselineLc.clear();
}

export function getExecutionModeBaselineLc(relativeStateId: string): number | undefined {
	return executionModeBaselineLc.get(relativeStateId);
}

export function clearStartupRearmRequired(): void {
	startupRearmRequired = false;
}

export type ConfirmLiveRearmHost = {
	log: { info: (msg: string) => void; warn?: (msg: string) => void };
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

/**
 * Explizite Benutzer-Freigabe für Geräte-Writes nach Adapter-Start.
 * Unabhängig von Mode-Toggle — Admin-Config-Save / Restart blockiert das nicht.
 */
export async function confirmStartupLiveRearm(
	host: ConfirmLiveRearmHost,
): Promise<{ ok: true; alreadyCleared: boolean } | { ok: false; error: string }> {
	const { BACKUP_INFO_STATES } = await import("./ensure_states.js");
	const { GLOBAL } = await import("../tree_paths.js");
	const { parseMode } = await import("../execution_mode.js");

	const alreadyCleared = !isStartupRearmRequired();
	const globalMode = parseMode((await host.getStateAsync(GLOBAL.executionMode))?.val);
	if (globalMode !== "live") {
		await host.setStateAsync(GLOBAL.executionMode, { val: "live", ack: true });
		await host.setStateAsync("execution.safety.global_execution_mode", { val: "live", ack: true });
	}

	clearStartupRearmRequired();
	try {
		await host.setStateAsync(BACKUP_INFO_STATES.liveRearmRequired, { val: false, ack: true });
		await host.setStateAsync(BACKUP_INFO_STATES.confirmLiveRearm, { val: false, ack: true });
	} catch {
		/* legacy info.backup states may already be purged */
	}
	host.log.info(
		alreadyCleared
			? "Startup-Rearm war bereits aufgehoben — live_rearm_required=false bestätigt"
			: "Startup-Rearm aufgehoben (confirm_live_rearm) — Geräte-Writes freigegeben",
	);
	return { ok: true, alreadyCleared };
}

/** Adapter-interne Writes (Sync, Reconciliation, Hydration) dürfen Rearm nicht aufheben. */
export function isAdapterInternalStateOrigin(from: unknown, adapterNamespace: string): boolean {
	const origin = String(from ?? "").trim();
	if (!origin) {
		return false;
	}
	if (origin === adapterNamespace) {
		return true;
	}
	if (origin.startsWith(`system.adapter.${adapterNamespace}`)) {
		return true;
	}
	return false;
}

export function isFreshUserStateChange(state: ioBroker.State | null, bootstrapCompletedAtMsValue: number): boolean {
	if (!state || state.ack) {
		return false;
	}
	if (bootstrapCompletedAtMsValue <= 0) {
		return false;
	}
	const ts = state.ts ?? 0;
	return ts >= bootstrapCompletedAtMsValue;
}

/**
 * Explizite Benutzer-Anforderung auf einem Execution-Mode-State (dryrun oder live).
 * Nicht ausreichend: Hydration, Reconciliation, interne Spiegelung, alter Request.
 */
export function isExplicitUserExecutionModeRequest(
	state: ioBroker.State | null,
	adapterNamespace: string,
	relativeStateId: string,
	bootstrapCompletedAtMsValue: number,
): boolean {
	if (!isFreshUserStateChange(state, bootstrapCompletedAtMsValue)) {
		return false;
	}
	if (isAdapterInternalStateOrigin(state?.from, adapterNamespace)) {
		return false;
	}
	const requested = String(state?.val ?? "").trim().toLowerCase();
	if (requested !== "dryrun" && requested !== "live") {
		return false;
	}
	const baselineLc = executionModeBaselineLc.get(relativeStateId);
	if (baselineLc !== undefined) {
		const currentLc = state?.lc ?? 0;
		if (currentLc <= baselineLc) {
			return false;
		}
	}
	return true;
}

/**
 * Startup-Rearm nur durch frischen externen live-Request auf global.execution_mode aufheben.
 * dryrun ist keine Zustimmung zu realen Geräte-Writes und hebt Rearm nicht auf.
 * Add-on-Execution-Mode-Requests allein heben Rearm ebenfalls nicht auf.
 */
export function isExplicitUserLiveRearmRequest(
	state: ioBroker.State | null,
	adapterNamespace: string,
	relativeStateId: string,
	bootstrapCompletedAtMsValue: number,
): boolean {
	if (relativeStateId !== "global.execution_mode") {
		return false;
	}
	if (!isExplicitUserExecutionModeRequest(state, adapterNamespace, relativeStateId, bootstrapCompletedAtMsValue)) {
		return false;
	}
	return String(state?.val ?? "").trim().toLowerCase() === "live";
}

export async function captureExecutionModeBaselineFromHost(
	host: {
		namespace: string;
		getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	},
	relativeStateIds: readonly string[],
): Promise<void> {
	clearExecutionModeBaseline();
	for (const id of relativeStateIds) {
		const st = await host.getStateAsync(id);
		recordExecutionModeBaseline(id, st?.lc ?? 0);
	}
}

export function resetStartupRearmForTest(): void {
	startupRearmRequired = false;
	bootstrapCompletedAtMs = 0;
	clearExecutionModeBaseline();
}
