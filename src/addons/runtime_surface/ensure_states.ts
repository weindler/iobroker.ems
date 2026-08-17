import type { StateHost } from "../../ems_light/state_util";

type EnsureHost = Pick<StateHost, "setObjectNotExistsAsync">;

/** Ensure Masterplan §10 surface — intern, keine ioBroker-States. */
export async function ensureAddonRuntimeSurfaceStates(_host: EnsureHost): Promise<void> {
	/* Addon-runtime.* bleibt die öffentliche Fläche. */
}
