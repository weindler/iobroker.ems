import type { StateHost } from "../../ems_light/state_util";
import { GOVERNED_ADDON_REGISTRY } from "../governance/registry";
import { addonRuntimeSurfaceBase, runtimeSurfaceStateMap } from "./paths";

type EnsureHost = Pick<StateHost, "setObjectNotExistsAsync">;

async function ensureState(
	host: EnsureHost,
	id: string,
	common: Record<string, unknown>,
	defVal: ioBroker.StateValue,
): Promise<void> {
	await host.setObjectNotExistsAsync(id, {
		type: "state",
		common: {
			read: true,
			write: false,
			def: defVal,
			...common,
		},
		native: {},
	} as ioBroker.Object);
}

/** Ensure Masterplan §10 surface channel + states for all governed addons (runtime ids). */
export async function ensureAddonRuntimeSurfaceStates(host: EnsureHost): Promise<void> {
	for (const entry of GOVERNED_ADDON_REGISTRY) {
		const runtimeId = entry.runtimeAddonId;
		const display = entry.displayNameDe;
		await host.setObjectNotExistsAsync(`addons.${runtimeId}`, {
			type: "channel",
			common: { name: display },
			native: {},
		} as ioBroker.Object);
		await host.setObjectNotExistsAsync(`addons.${runtimeId}.runtime`, {
			type: "channel",
			common: { name: `${display} Runtime` },
			native: {},
		} as ioBroker.Object);
		await host.setObjectNotExistsAsync(addonRuntimeSurfaceBase(runtimeId), {
			type: "channel",
			common: { name: `${display} Runtime Surface (einheitlich)` },
			native: {},
		} as ioBroker.Object);

		const ids = runtimeSurfaceStateMap(runtimeId);
		await ensureState(host, ids.decisionSource, {
			name: `${display}: Entscheidungsquelle (kanonisch)`,
			type: "string",
			role: "text",
		}, "safety");
		await ensureState(host, ids.decisionDetail, {
			name: `${display}: Entscheidungsdetail`,
			type: "string",
			role: "text",
		}, "safe_default");
		await ensureState(host, ids.decisionReason, {
			name: `${display}: Entscheidungsgrund`,
			type: "string",
			role: "text",
		}, "");
		await ensureState(host, ids.lastDecisionAt, {
			name: `${display}: Letzte Entscheidung`,
			type: "string",
			role: "text",
		}, "");
		await ensureState(host, ids.plannerStatus, {
			name: `${display}: Planner-Status`,
			type: "string",
			role: "text",
		}, "missing");
		await ensureState(host, ids.intentStatus, {
			name: `${display}: Intent-Status`,
			type: "string",
			role: "text",
		}, "none");
		await ensureState(host, ids.executionStatus, {
			name: `${display}: Ausführungsstatus`,
			type: "string",
			role: "text",
		}, "idle");
		await ensureState(host, ids.profileReady, {
			name: `${display}: Profil bereit`,
			type: "boolean",
			role: "indicator",
		}, false);
		await ensureState(host, ids.telemetryReady, {
			name: `${display}: Telemetrie bereit`,
			type: "boolean",
			role: "indicator",
		}, false);
		await ensureState(host, ids.fault, {
			name: `${display}: Fault`,
			type: "boolean",
			role: "indicator.alarm",
		}, false);
		await ensureState(host, ids.lockout, {
			name: `${display}: Lockout`,
			type: "boolean",
			role: "indicator.alarm",
		}, false);
	}
}
