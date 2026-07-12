/** Verhindert Geräte-Runtime vor abgeschlossenem State-Bootstrap. */
let bootstrapComplete = false;
let bootstrapFailedPhase: string | null = null;

export function isBootstrapComplete(): boolean {
	return bootstrapComplete;
}

export function bootstrapFailurePhase(): string | null {
	return bootstrapFailedPhase;
}

export function markBootstrapFailed(phase: string): void {
	if (!bootstrapFailedPhase) {
		bootstrapFailedPhase = phase;
	}
}

export function markBootstrapComplete(): void {
	bootstrapComplete = true;
}

/** Nur für Tests — Bootstrap-Zustand zurücksetzen. */
export function resetBootstrapBarrierForTest(): void {
	bootstrapComplete = false;
	bootstrapFailedPhase = null;
}
