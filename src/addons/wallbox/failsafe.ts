import { isLiveWriteAllowed } from "../../execution_mode";
import {
	failsafeTimeoutsFromConfig,
	isEmsUnreachable,
	readForeignBool,
	readForeignNumber,
	setEdgeBool,
} from "../../failsafe_common";
import { mappingBase } from "../../tree_paths";
import { WALLBOX_STATUS_STATES } from "../../status_wallbox";
import type { CommandIntent, PipelineOutcome } from "../../types";

const ADDON_ID = "wallbox";

type WallboxPending =
	| {
			kind: "enable";
			expected: boolean;
			sinceMs: number;
			targetId: string;
	  }
	| {
			kind: "power";
			expectedWatts: number;
			sinceMs: number;
			enableTargetId: string;
			powerFeedbackId: string;
			steadyMax: boolean;
	  }
	| null;

let pending: WallboxPending = null;
let lastEmsReachable: boolean | null = null;
let lastImmediateFail = false;

function maxChargeWFromConfig(config: Record<string, unknown>): number {
	const n = Number(config.wb_max_charge_w);
	return Number.isFinite(n) && n > 0 ? n : 11000;
}

async function enableTargetId(adapter: ioBroker.Adapter): Promise<string> {
	const base = mappingBase(ADDON_ID, "set_enabled");
	const en = await adapter.getStateAsync(`${base}.enabled`);
	if (en?.val === false) return "";
	const ts = await adapter.getStateAsync(`${base}.target_state`);
	return typeof ts?.val === "string" ? ts.val.trim() : "";
}

function powerFeedbackIdFromConfig(config: Record<string, unknown>): string {
	const t = config.wb_feedback_power_target;
	return typeof t === "string" ? t.trim() : "";
}

/** Feedback-State kann W oder kW liefern (go-e: energy.neutral.power oft kW). */
function feedbackPowerToWatts(raw: number, config: Record<string, unknown>): number {
	const unit = String(config.wb_feedback_power_unit ?? "w").toLowerCase();
	if (unit === "kw" || unit === "kwh") {
		return raw * 1000;
	}
	return raw;
}

async function readFeedbackPowerW(adapter: ioBroker.Adapter, cfg: Record<string, unknown>): Promise<number | null> {
	const id = powerFeedbackIdFromConfig(cfg);
	if (!id) return null;
	const raw = await readForeignNumber(adapter, id);
	if (raw == null) return null;
	return feedbackPowerToWatts(raw, cfg);
}

export function recordWallboxPipelineResult(
	_config: Record<string, unknown>,
	intent: CommandIntent,
	outcome: PipelineOutcome,
): void {
	lastImmediateFail = false;
	if (intent.addon_id !== ADDON_ID) {
		return;
	}
	if (outcome.result !== "success" || outcome.reason !== "live_write") {
		if (outcome.checks_failed.includes("live_write_failed")) {
			lastImmediateFail = true;
		}
		pending = null;
		return;
	}

	const target = outcome.target_state ?? "";
	const now = Date.now();

	if (intent.command === "set_enabled") {
		pending = {
			kind: "enable",
			expected: intent.value === true || intent.value === 1 || intent.value === "1",
			sinceMs: now,
			targetId: target,
		};
		return;
	}

	if (intent.command === "set_charge_power_w") {
		const planned = outcome.planned_value;
		let watts = typeof intent.value === "number" ? intent.value : 0;
		if (typeof planned === "object" && planned !== null && "watts" in planned) {
			const w = (planned as { watts?: number }).watts;
			if (typeof w === "number") watts = w;
		}
		const cfg = _config;
		const maxW = maxChargeWFromConfig(cfg);
		pending = {
			kind: "power",
			expectedWatts: watts,
			sinceMs: now,
			enableTargetId: "",
			powerFeedbackId: powerFeedbackIdFromConfig(cfg),
			steadyMax: watts >= maxW * 0.85,
		};
	}
}

async function forceWallboxSafeOff(adapter: ioBroker.Adapter, reason: string): Promise<boolean> {
	const live = await isLiveWriteAllowed((id) => adapter.getStateAsync(id), ADDON_ID);
	if (!live) return false;
	const targetId = await enableTargetId(adapter);
	if (!targetId) {
		adapter.log.warn(`wallbox failsafe (${reason}): no set_enabled mapping`);
		return false;
	}
	try {
		await adapter.setForeignStateAsync(targetId, { val: false, ack: true });
		adapter.log.warn(`wallbox failsafe (${reason}): charging disabled → ${targetId}`);
		return true;
	} catch (e) {
		adapter.log.error(`wallbox failsafe write failed: ${e}`);
		return false;
	}
}

async function verifyPending(adapter: ioBroker.Adapter, cfg: Record<string, unknown>): Promise<boolean> {
	if (!pending) return true;

	const { verificationTimeoutSec } = failsafeTimeoutsFromConfig(cfg, "wb");
	const elapsed = Date.now() - pending.sinceMs;
	if (elapsed < verificationTimeoutSec * 1000) {
		return true;
	}

	if (pending.kind === "enable") {
		const actual = await readForeignBool(adapter, pending.targetId);
		if (actual === pending.expected) return true;
		return false;
	}

	if (pending.steadyMax) {
		return true;
	}

	const feedbackId = pending.powerFeedbackId;
	if (!feedbackId) {
		return true;
	}

	const actualW = await readFeedbackPowerW(adapter, cfg);
	if (actualW == null) {
		return false;
	}

	const tol = Number(cfg.wb_verification_tolerance_pct);
	const pct = Number.isFinite(tol) && tol > 0 ? tol / 100 : 0.15;
	const expected = pending.expectedWatts;
	if (expected <= 0) {
		return actualW < 200;
	}
	return Math.abs(actualW - expected) <= Math.max(500, expected * pct);
}

export async function runWallboxFailsafeCheck(adapter: ioBroker.Adapter): Promise<void> {
	const cfg =
		adapter.config && typeof adapter.config === "object"
			? (adapter.config as Record<string, unknown>)
			: {};
	const liveAllowed = await isLiveWriteAllowed((id) => adapter.getStateAsync(id), ADDON_ID);
	const emsReachable = !isEmsUnreachable(cfg, "wb");

	await setEdgeBool(adapter, WALLBOX_STATUS_STATES.emsReachable, emsReachable);

	if (lastEmsReachable !== emsReachable) {
		lastEmsReachable = emsReachable;
		adapter.log.info(`wallbox: ems_reachable=${emsReachable}`);
	}

	const verifyOk = lastImmediateFail ? false : await verifyPending(adapter, cfg);
	const shouldTrip = !emsReachable || !verifyOk || lastImmediateFail;

	await setEdgeBool(adapter, WALLBOX_STATUS_STATES.failsafeWouldTrip, shouldTrip && !liveAllowed);

	const ts = new Date().toISOString();
	await adapter.setStateAsync(WALLBOX_STATUS_STATES.updatedAt, { val: ts, ack: true });

	if (!shouldTrip) {
		if (verifyOk && pending) {
			await setEdgeBool(adapter, WALLBOX_STATUS_STATES.actuatorReachable, true);
			await setEdgeBool(adapter, WALLBOX_STATUS_STATES.addonDead, false);
		}
		const active = await adapter.getStateAsync(WALLBOX_STATUS_STATES.failsafeActive);
		if (active?.val === true && liveAllowed) {
			await adapter.setStateAsync(WALLBOX_STATUS_STATES.failsafeActive, { val: false, ack: true });
		}
		return;
	}

	if (!liveAllowed) {
		return;
	}

	const reason = !emsReachable
		? "ems_unreachable"
		: lastImmediateFail
			? "live_write_failed"
			: "verification_timeout";
	const wrote = await forceWallboxSafeOff(adapter, reason);
	if (wrote) {
		await setEdgeBool(adapter, WALLBOX_STATUS_STATES.actuatorReachable, false);
		await setEdgeBool(adapter, WALLBOX_STATUS_STATES.addonDead, true);
		await adapter.setStateAsync(WALLBOX_STATUS_STATES.failsafeActive, { val: true, ack: true });
		await adapter.setStateAsync(WALLBOX_STATUS_STATES.lastFailsafeAt, { val: ts, ack: true });
		pending = null;
	}
}
