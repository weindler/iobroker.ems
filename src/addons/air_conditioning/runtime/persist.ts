import type { AcUnitModePurpose } from "../types";
import { emptyDeviceOwnershipState, type DeviceOwnershipState } from "../../../ems_light/device_ownership";

/** Spiegel von stop_intent.AcCoolingDesired — hier lokal, kein Import-Zyklus. */
export type AcPersistCoolingDesired = "on" | "off" | "hold" | "idle";

export type AcUnitPersist = {
	index: number;
	running: boolean;
	cleaningActive: boolean;
	cleaningStartedAtMs: number | null;
	cleaningPendingUntilMs: number | null;
	cleaningSawOperatingActive: boolean;
	cleaningSawProgressActive: boolean;
	cleaningStartProgressPct: number | null;
	cleaningLastRefreshAtMs: number | null;
	lastStartAtMs: number | null;
	lastStopAtMs: number | null;
	/** Last mode purpose written to the device (cool/dry switch while running). */
	lastModePurpose: AcUnitModePurpose | null;
	/** Monotone Desired-Wechsel — stale STOP-Kampagnen erkennen. */
	commandGeneration: number;
	/** Generation, unter der der aktuelle STOP bewaffnet wurde; null = keine Kampagne. */
	stopArmedGeneration: number | null;
	/** Letztes aufgelöstes Desired (für Generation-Bump). */
	lastDesired: AcPersistCoolingDesired | null;
	/** Klima-/Ownership-Block: erkannter Manual-Override (ems/user), zeitbegrenzt. */
	ownership: DeviceOwnershipState;
};

export type AcRuntimePersist = {
	version: 1;
	units: Record<number, AcUnitPersist>;
};

export const AC_RUNTIME_FILENAME = "air_conditioning_runtime_v1.json";

export function emptyUnitPersist(index: number): AcUnitPersist {
	return {
		index,
		running: false,
		cleaningActive: false,
		cleaningStartedAtMs: null,
		cleaningPendingUntilMs: null,
		cleaningSawOperatingActive: false,
		cleaningSawProgressActive: false,
		cleaningStartProgressPct: null,
		cleaningLastRefreshAtMs: null,
		lastStartAtMs: null,
		lastStopAtMs: null,
		lastModePurpose: null,
		commandGeneration: 0,
		stopArmedGeneration: null,
		lastDesired: null,
		ownership: emptyDeviceOwnershipState(),
	};
}

export function emptyAcRuntimePersist(): AcRuntimePersist {
	return { version: 1, units: {} };
}
