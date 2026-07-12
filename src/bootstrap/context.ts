/** Laufzeitkontext eines einzelnen Bootstrap-Durchlaufs (kein dauerhaftes Modul-Global). */
export type BootstrapRunContext = {
	coldStartRecovery: boolean;
};

let activeBootstrapContext: BootstrapRunContext | null = null;

export function beginBootstrapRun(coldStartRecovery: boolean): BootstrapRunContext {
	activeBootstrapContext = { coldStartRecovery };
	return activeBootstrapContext;
}

export function getBootstrapRunContext(): BootstrapRunContext | null {
	return activeBootstrapContext;
}

export function endBootstrapRun(): void {
	activeBootstrapContext = null;
}
