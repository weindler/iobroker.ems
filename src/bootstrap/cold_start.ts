/** Marker-Objekte — wenn keines existiert, war der Namespace vor dem Bootstrap leer. */
const COLD_START_MARKERS = [
	"global",
	"global.execution_mode",
	"system.version",
	"command.inbox",
] as const;

export type ColdStartDetectHost = {
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
};

/**
 * Erkennt einen vollständigen Cold Start (leerer `ems.0.*`-Namespace).
 * Muss vor dem ersten Ensure-Schritt aufgerufen werden.
 */
export async function detectFullNamespaceColdStart(host: ColdStartDetectHost): Promise<boolean> {
	for (const id of COLD_START_MARKERS) {
		if (host.getObjectAsync) {
			const obj = await host.getObjectAsync(id);
			if (obj) {
				return false;
			}
		}
		const st = await host.getStateAsync(id);
		if (st !== null && st !== undefined) {
			return false;
		}
	}
	return true;
}
