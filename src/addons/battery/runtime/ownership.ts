export interface OwnershipState {
	active: boolean;
	requestId: string | null;
	startedAt: string | null;
	originalMode: number | null;
	manualModeWritten: boolean;
}

export function emptyOwnership(): OwnershipState {
	return {
		active: false,
		requestId: null,
		startedAt: null,
		originalMode: null,
		manualModeWritten: false,
	};
}

/** Safe Restore nur, wenn EMS die Batterie selbst in den manuellen Modus versetzt hat. */
export function canSafeRestore(ownership: OwnershipState): boolean {
	return ownership.active && ownership.manualModeWritten;
}

/**
 * Fremde manuelle Steuerung: Gerät steht im manuellen Modus, ohne dass aktuelle
 * EMS-Ownership nachweisbar ist. EMS darf das nicht ungefragt überschreiben.
 */
export function isForeignManualControl(input: {
	currentMode: number | null;
	manualModeValue: number;
	ownership: OwnershipState;
}): boolean {
	return input.currentMode === input.manualModeValue && !input.ownership.active;
}
