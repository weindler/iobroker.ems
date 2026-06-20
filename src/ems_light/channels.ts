import { ensureChannel, type StateHost } from "./state_util";

/** EMS-Light Kanäle (Phase 1) — ergänzt bestehenden Baum, löscht nichts. */
export const EMS_LIGHT_CHANNEL_IDS: Array<{ id: string; nameDe: string }> = [
	{ id: "profiles", nameDe: "EMS-Light Profile" },
	{ id: "live", nameDe: "EMS-Light Live-Cache" },
	{ id: "learning", nameDe: "EMS-Light Learning" },
	{ id: "planner", nameDe: "EMS-Light Planner" },
	{ id: "planner.intent", nameDe: "EMS-Light Planner Intents" },
	{ id: "operator", nameDe: "EMS-Light Operator" },
	{ id: "execution", nameDe: "EMS-Light Execution" },
	{ id: "execution.dryrun", nameDe: "EMS-Light Execution Dryrun" },
	{ id: "execution.safety", nameDe: "EMS-Light Execution Safety" },
	{ id: "system", nameDe: "EMS-Light System" },
	{ id: "economics", nameDe: "EMS-Light Economics (Reporting)" },
];

export async function ensureEmsLightChannels(host: StateHost): Promise<void> {
	for (const ch of EMS_LIGHT_CHANNEL_IDS) {
		await ensureChannel(host, ch.id, ch.nameDe);
	}
}
