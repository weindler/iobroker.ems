export type AcUnitPersist = {
	index: number;
	running: boolean;
	cleaningActive: boolean;
	cleaningStartedAtMs: number | null;
	lastStartAtMs: number | null;
	lastStopAtMs: number | null;
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
		lastStartAtMs: null,
		lastStopAtMs: null,
	};
}

export function emptyAcRuntimePersist(): AcRuntimePersist {
	return { version: 1, units: {} };
}
