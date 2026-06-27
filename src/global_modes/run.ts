import type { StateHost } from "../ems_light/state_util";
import { setStatesIfRevisionChanged } from "../policy/core/state_write";
import { DEFAULT_GLOBAL_MODE } from "./constants";
import { globalModeDefaultFromConfig } from "./config";
import { ensureGlobalModesStates } from "./ensure_states";
import { writeGlobalModesPersist, readGlobalModesPersistRevision } from "./persist";
import { resolveGlobalModes } from "./resolve";
import { availableModesJson, profileForMode } from "./schema";
import type { GlobalModeResolution } from "./types";

export type GlobalModesHost = StateHost & {
	config?: unknown;
	getAbsolutePath?: (category?: string) => string;
	log: { info: (msg: string) => void; warn: (msg: string) => void; debug?: (msg: string) => void };
};

let lastActiveMode: string | null = null;

export async function runGlobalModes(host: GlobalModesHost): Promise<GlobalModeResolution> {
	const adminDefault = globalModeDefaultFromConfig(host.config);
	await ensureGlobalModesStates(host, adminDefault);

	const requestedSt = await host.getStateAsync("global_modes.requested");
	const hasPersistedRequested =
		requestedSt?.val !== undefined && requestedSt.val !== null && String(requestedSt.val).trim() !== "";

	let requestedRaw = requestedSt?.val;
	if (!hasPersistedRequested) {
		await host.setStateAsync("global_modes.requested", { val: adminDefault, ack: true });
		requestedRaw = adminDefault;
	}

	const resolution = resolveGlobalModes({
		requestedRaw,
		adminDefault,
		hasPersistedRequested,
	});

	const ts = new Date().toISOString();
	const issuesJson = JSON.stringify(resolution.issues);
	const profileJson = JSON.stringify(profileForMode(resolution.active));

	const writes = [
		{ id: "global_modes.active", val: resolution.active },
		{ id: "global_modes.available_json", val: availableModesJson() },
		{ id: "global_modes.effective_profile_json", val: profileJson },
		{ id: "global_modes.status", val: resolution.status },
		{ id: "global_modes.valid", val: resolution.valid },
		{ id: "global_modes.issues_json", val: issuesJson },
	];

	const { changed } = await setStatesIfRevisionChanged(
		host,
		"global_modes.revision",
		resolution.revision,
		writes,
		"global_modes.updated_at",
		ts,
	);

	if (lastActiveMode !== null && lastActiveMode !== resolution.active) {
		host.log.info(`Global Mode changed: ${lastActiveMode} -> ${resolution.active}`);
	}
	lastActiveMode = resolution.active;

	if (changed && resolution.status === "fallback") {
		host.log.warn(`Global Mode fallback: active=${DEFAULT_GLOBAL_MODE} (${resolution.issues[0]?.message ?? ""})`);
	}

	const dataDir = host.getAbsolutePath?.("global_modes");
	if (dataDir) {
		const prev = await readGlobalModesPersistRevision(dataDir);
		if (prev !== resolution.revision) {
			await writeGlobalModesPersist(dataDir, resolution);
		}
	}

	return resolution;
}

export function resetGlobalModesRuntime(): void {
	lastActiveMode = null;
}
