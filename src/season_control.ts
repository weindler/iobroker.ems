/** Laufzeit-Sperre für saisonal nicht verwendete Wärme-/Klima-Add-ons. */
let winterActive = false;
let configuredStateId = "";
let invertSignal = false;

export const WINTER_RUNTIME_STATE = "global.winter_operation_active";

type Host = Pick<ioBroker.Adapter, "config" | "getStateAsync" | "setStateAsync" | "setObjectNotExistsAsync" | "subscribeForeignStatesAsync" | "log">;

function config(host: Host): Record<string, unknown> {
	return host.config as unknown as Record<string, unknown>;
}

function boolValue(value: unknown): boolean | null {
	if (value === true || value === 1 || value === "true" || value === "1" || value === "on") return true;
	if (value === false || value === 0 || value === "false" || value === "0" || value === "off") return false;
	return null;
}

async function publish(host: Host, active: boolean): Promise<void> {
	winterActive = active;
	await host.setStateAsync(WINTER_RUNTIME_STATE, { val: active, ack: true });
}

export async function initSeasonControl(host: Host): Promise<void> {
	const c = config(host);
	configuredStateId = String(c.winter_operation_state ?? "").trim();
	invertSignal = c.winter_operation_invert === true;
	await host.setObjectNotExistsAsync(WINTER_RUNTIME_STATE, {
		type: "state",
		common: {
			name: "Winterbetrieb aktiv – Klima- und Heizstabplanung pausiert",
			type: "boolean",
			role: "indicator",
			read: true,
			write: false,
			def: false,
		},
		native: {},
	} as ioBroker.Object);
	if (!configuredStateId) {
		await publish(host, false);
		return;
	}
	const previous = boolValue((await host.getStateAsync(WINTER_RUNTIME_STATE))?.val);
	const source = boolValue((await host.getStateAsync(configuredStateId))?.val);
	// Bei einem Ausfall nie eigenmächtig umschalten. Existiert noch kein
	// bestätigter Wert, ist Pausieren der sichere Erstzustand.
	await publish(host, source === null ? (previous ?? true) : (invertSignal ? !source : source));
	await host.subscribeForeignStatesAsync(configuredStateId);
	host.log.info(`Saisonsteuerung aktiv: ${configuredStateId}; Winter=${winterActive}`);
}

export async function handleSeasonStateChange(host: Host, id: string, state: ioBroker.State | null): Promise<boolean> {
	if (!configuredStateId || id !== configuredStateId || !state) return false;
	const source = boolValue(state.val);
	if (source === null) {
		host.log.warn("Winterbetrieb: ungültiger Eingangswert – letzter bestätigter Zustand bleibt erhalten");
		return true;
	}
	const next = invertSignal ? !source : source;
	if (next !== winterActive) {
		await publish(host, next);
		host.log.info(next
			? "Winterbetrieb aktiv – Klima-/Heizstabplanung und EMS-Schreibbefehle pausiert"
			: "Sommerbetrieb aktiv – Klima-/Heizstabplanung wieder freigegeben");
	}
	return true;
}

export function isWinterOperationActive(): boolean {
	return winterActive;
}

export function isSeasonallyPausedAddon(addonId: string): boolean {
	return winterActive && (addonId === "air_conditioning" || addonId === "immersion_heater");
}
