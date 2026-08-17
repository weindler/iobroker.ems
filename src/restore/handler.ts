import { BACKUP_STATES, RESTORE_STATES } from "../backup/ensure_states";
import { invalidateRestorePlan, getActiveRestorePlan } from "./plan";
import { runRestoreValidate, runRestoreApply, planSummaryJson } from "./apply";
import { maybeInjectRestoreHandlerAfterCommitted } from "./apply_hooks";
import type { RestoreHost } from "./types";
import { isRestoreRestartRequired } from "./barrier";

function isConsciousRequest(val: unknown, ack: boolean | undefined): boolean {
	return val === true && ack !== true;
}

async function setRestoreStatus(
	host: RestoreHost,
	patch: Partial<{
		status: string;
		running: boolean;
		planId: string;
		planExpiresAt: string;
		archiveSha256: string;
		summaryJson: string;
		lastError: string;
		lastResult: string;
		lastRestoreAt: string;
		lastFileName: string;
		transactionId: string;
		restartRequired: boolean;
	}>,
): Promise<void> {
	const map: Array<[string, ioBroker.StateValue]> = [];
	if (patch.status !== undefined) map.push([RESTORE_STATES.status, patch.status]);
	if (patch.running !== undefined) map.push([RESTORE_STATES.running, patch.running]);
	if (patch.planId !== undefined) map.push([RESTORE_STATES.planId, patch.planId]);
	if (patch.summaryJson !== undefined) map.push([RESTORE_STATES.summaryJson, patch.summaryJson]);
	if (patch.lastError !== undefined) map.push([RESTORE_STATES.lastError, patch.lastError]);
	if (patch.lastResult !== undefined) map.push([RESTORE_STATES.lastResult, patch.lastResult]);
	if (patch.lastRestoreAt !== undefined) map.push([RESTORE_STATES.lastRestoreAt, patch.lastRestoreAt]);
	if (patch.lastFileName !== undefined) map.push([RESTORE_STATES.lastFileName, patch.lastFileName]);
	if (patch.restartRequired !== undefined) map.push([RESTORE_STATES.restartRequired, patch.restartRequired]);
	for (const [id, val] of map) {
		await host.setStateAsync(id, { val, ack: true });
	}
}

export async function initRestoreRuntime(host: RestoreHost): Promise<void> {
	invalidateRestorePlan();
	await host.setStateAsync(RESTORE_STATES.validateRequest, { val: false, ack: true });
	await host.setStateAsync(RESTORE_STATES.applyRequest, { val: false, ack: true });
	await host.setStateAsync(RESTORE_STATES.confirmPlanId, { val: "", ack: true });
	await setRestoreStatus(host, {
		status: "idle",
		running: false,
		planId: "",
		planExpiresAt: "",
		archiveSha256: "",
		summaryJson: "{}",
		lastError: "",
		restartRequired: isRestoreRestartRequired(),
	});
}

export async function handleRestoreValidateRequest(host: RestoreHost, val: unknown, ack?: boolean): Promise<void> {
	if (!isConsciousRequest(val, ack)) return;
	await host.setStateAsync(RESTORE_STATES.validateRequest, { val: false, ack: true });
	const fileSt = await host.getStateAsync(RESTORE_STATES.selectedFile);
	const fileName = typeof fileSt?.val === "string" ? fileSt.val.trim() : "";
	if (!fileName) {
		await setRestoreStatus(host, { status: "error", lastError: "no_file_selected" });
		return;
	}
	try {
		await setRestoreStatus(host, { status: "validating", running: true, lastError: "" });
		const result = await runRestoreValidate(host, fileName);
		if (result.ok) {
			const plan = getActiveRestorePlan();
			await setRestoreStatus(host, {
				status: "ready",
				running: false,
				planId: plan?.planId ?? "",
				planExpiresAt: plan?.expiresAt ?? "",
				archiveSha256: plan?.identity.archiveSha256 ?? "",
				summaryJson: plan ? planSummaryJson(plan) : "{}",
				lastError: "",
			});
		} else {
			invalidateRestorePlan();
			await setRestoreStatus(host, {
				status: "error",
				running: false,
				planId: "",
				planExpiresAt: "",
				summaryJson: "{}",
				lastError: result.error,
			});
		}
	} finally {
		await setRestoreStatus(host, { running: false });
	}
}

export async function handleRestoreApplyRequest(host: RestoreHost, val: unknown, ack?: boolean): Promise<void> {
	if (!isConsciousRequest(val, ack)) return;
	await host.setStateAsync(RESTORE_STATES.applyRequest, { val: false, ack: true });
	const fileSt = await host.getStateAsync(RESTORE_STATES.selectedFile);
	const fileName = typeof fileSt?.val === "string" ? fileSt.val.trim() : "";
	const confirmSt = await host.getStateAsync(RESTORE_STATES.confirmPlanId);
	const confirmPlanId = typeof confirmSt?.val === "string" ? confirmSt.val.trim() : "";
	if (!fileName || !confirmPlanId) {
		await setRestoreStatus(host, { status: "error", lastError: "missing_confirm_plan_id" });
		return;
	}
	try {
		await setRestoreStatus(host, { status: "applying", running: true, lastError: "" });
		const result = await runRestoreApply(host, fileName, confirmPlanId);
		if (result.ok) {
			maybeInjectRestoreHandlerAfterCommitted();
			await setRestoreStatus(host, {
				status: "success_restart_required",
				running: false,
				lastResult: "success_restart_required",
				lastRestoreAt: new Date().toISOString(),
				lastFileName: fileName,
				transactionId: result.transactionId ?? "",
				restartRequired: true,
				lastError: "",
				planId: "",
				planExpiresAt: "",
				summaryJson: "{}",
			});
			await host.setStateAsync(RESTORE_STATES.confirmPlanId, { val: "", ack: true });
		} else if (result.status === "rolled_back") {
			await setRestoreStatus(host, {
				status: "rolled_back",
				running: false,
				lastError: result.error,
				lastResult: "rolled_back",
			});
		} else if (result.status === "recovery_failed") {
			await setRestoreStatus(host, {
				status: "recovery_failed",
				running: false,
				lastError: result.error,
				lastResult: "failed",
			});
		} else {
			await setRestoreStatus(host, {
				status: "error",
				running: false,
				lastError: result.error,
				lastResult: "error",
			});
		}
	} finally {
		await setRestoreStatus(host, { running: false });
	}
}

export function isRestoreRelatedState(relativeId: string): boolean {
	return (
		relativeId === RESTORE_STATES.validateRequest ||
		relativeId === RESTORE_STATES.applyRequest ||
		relativeId === RESTORE_STATES.selectedFile ||
		relativeId.startsWith("backup.restore.")
	);
}

export async function handleRestoreStateChange(
	host: RestoreHost,
	relativeId: string,
	val: unknown,
	ack?: boolean,
): Promise<void> {
	if (relativeId === RESTORE_STATES.validateRequest) {
		await handleRestoreValidateRequest(host, val, ack);
		return;
	}
	if (relativeId === RESTORE_STATES.applyRequest) {
		await handleRestoreApplyRequest(host, val, ack);
	}
}

export { RESTORE_STATES };
