/**
 * Schreibweg „evcc“ für die Hausbatterie.
 *
 * Statt die Sonnen direkt zu schalten, setzt EMS den evcc-Batteriemodus
 * (hass.0…select.evcc_battery_mode.select_option): `hold` hält die Batterie,
 * `charge` lädt sie aus dem Netz, `normal` gibt frei. evcc setzt den Modus nach ca. 60 s
 * selbst zurück — deshalb erneuert EMS ihn regelmäßig, solange er gelten soll. Fällt EMS aus,
 * springt die Batterie von allein auf normal zurück.
 */
import type { BatteryDeviceIntent } from "./core/types";
import { writeForeignIfChanged, type DeviceWriteHost } from "../../device_write";

export type EvccBatteryMode = "normal" | "hold" | "charge";

/** Erneuerung deutlich unter dem 60-s-Auto-Reset von evcc. */
export const EVCC_MODE_KEEPALIVE_MS = 25_000;

export interface EvccModeDecisionInput {
	intent: Pick<BatteryDeviceIntent, "action" | "energySource">;
	/** evcc/Tibber/externer Anbieter steuert die Batterie gerade selbst → nicht eingreifen. */
	externalAuthority: boolean;
}

export interface EvccModeDecision {
	/** null = nichts anfordern (Normalbetrieb). */
	mode: EvccBatteryMode | null;
	reasonDe: string;
}

export function decideEvccBatteryMode(input: EvccModeDecisionInput): EvccModeDecision {
	if (input.externalAuthority) {
		return { mode: null, reasonDe: "evcc/Tibber steuert die Batterie selbst — EMS schreibt nichts." };
	}
	const action = input.intent.action;
	if (action === "grid_charge" || (action === "charge" && input.intent.energySource === "grid")) {
		return { mode: "charge", reasonDe: "Geplantes Netzladen — evcc-Modus „laden“." };
	}
	if (action === "hold" || action === "protect_reserve") {
		return { mode: "hold", reasonDe: "Batterie soll gehalten werden — evcc-Modus „halten“." };
	}
	return { mode: null, reasonDe: "Normalbetrieb — EMS schreibt nichts, evcc und Batterie laufen im Eigenverbrauch." };
}

export interface EvccOutputState {
	lastWrittenMode: EvccBatteryMode | null;
	lastWriteMs: number;
}

export const EVCC_OUTPUT_INITIAL: EvccOutputState = { lastWrittenMode: null, lastWriteMs: 0 };

export interface EvccOutputStep {
	/** Was jetzt an evcc geschrieben werden soll (null = nichts). */
	write: EvccBatteryMode | null;
	next: EvccOutputState;
}

/** Reine Ablaufentscheidung: Änderung sofort, gleicher Modus nur als Keepalive, Freigabe einmalig explizit. */
export function planEvccOutputStep(
	desired: EvccBatteryMode | null,
	state: EvccOutputState,
	nowMs: number,
): EvccOutputStep {
	if (desired === null) {
		if (state.lastWrittenMode !== null && state.lastWrittenMode !== "normal") {
			return { write: "normal", next: { lastWrittenMode: "normal", lastWriteMs: nowMs } };
		}
		return { write: null, next: state };
	}
	if (state.lastWrittenMode !== desired || nowMs - state.lastWriteMs >= EVCC_MODE_KEEPALIVE_MS) {
		return { write: desired, next: { lastWrittenMode: desired, lastWriteMs: nowMs } };
	}
	return { write: null, next: state };
}

export interface EvccWriteParams {
	stateId: string;
	mode: EvccBatteryMode;
	/** false = nur simulieren (Trockenlauf). */
	live: boolean;
	reason: string;
}

export interface EvccWriteResult {
	written: boolean;
	simulated: boolean;
	rejectCode: string | null;
}

export async function writeEvccBatteryMode(
	host: DeviceWriteHost & { log: { debug: (m: string) => void; warn: (m: string) => void } },
	params: EvccWriteParams,
): Promise<EvccWriteResult> {
	if (!params.stateId.trim()) return { written: false, simulated: false, rejectCode: "missing_mapping" };
	if (!params.live) {
		host.log.debug(`battery evcc dryrun would_write ${params.mode} → ${params.stateId} (${params.reason})`);
		return { written: false, simulated: true, rejectCode: null };
	}
	try {
		// force: der Modus ist kurzlebig; der gelesene Zustand kann nach dem Auto-Reset veraltet sein.
		const r = await writeForeignIfChanged(host, {
			stateId: params.stateId,
			value: params.mode,
			reason: `battery evcc mode: ${params.reason}`,
			force: true,
		});
		if (r.blocked) return { written: false, simulated: false, rejectCode: r.blockReason ?? "blocked" };
		return { written: r.written, simulated: false, rejectCode: null };
	} catch (e) {
		host.log.warn(`battery evcc mode write failed ${params.stateId}: ${String(e)}`);
		return { written: false, simulated: false, rejectCode: "write_failed" };
	}
}
