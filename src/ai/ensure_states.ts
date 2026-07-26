import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";

export const AI_BASE = "ai";

export const AI_STATES = {
	status: `${AI_BASE}.status`,
	callsToday: `${AI_BASE}.calls_today`,
	callsTodayDate: `${AI_BASE}.calls_today_date`,
	callsLimit: `${AI_BASE}.calls_limit`,
	limitWarning: `${AI_BASE}.limit_warning`,
	costEstimateTodayEur: `${AI_BASE}.cost_estimate_today_eur`,
	lastRunAt: `${AI_BASE}.last_run_at`,
	lastAutoTriggerAtMs: `${AI_BASE}.last_auto_trigger_at_ms`,
	lastRunResult: `${AI_BASE}.last_run_result`,
	lastReasonDe: `${AI_BASE}.last_reason_de`,
	lastError: `${AI_BASE}.last_error`,
	lastSlotPreferencesJson: `${AI_BASE}.last_slot_preferences_json`,
	optimizeNowRequest: `${AI_BASE}.optimize_now_request`,
} as const;

export async function ensureAiStates(host: StateHost): Promise<void> {
	await ensureChannel(host, AI_BASE, "EMS KI-Optimierung (optional)");

	const defs: StateDef[] = [
		{
			id: AI_STATES.status,
			common: {
				name: "KI-Status",
				type: "string",
				role: "text",
				read: true,
				write: false,
				def: "off",
				states: {
					off: "Aus",
					ready: "Bereit",
					limit_reached: "Tageslimit erreicht",
					error: "Fehler",
					no_token: "Kein Token",
					no_addons_allowed: "Kein Add-on freigegeben",
				},
			},
		},
		{
			id: AI_STATES.callsToday,
			common: { name: "KI-Aufrufe heute", type: "number", role: "value", read: true, write: false, def: 0 },
		},
		{
			id: AI_STATES.callsTodayDate,
			common: {
				name: "KI-Zähler gilt für Tag (intern)",
				type: "string",
				role: "text",
				read: true,
				write: false,
				def: "",
			},
		},
		{
			id: AI_STATES.callsLimit,
			common: { name: "KI-Tageslimit", type: "number", role: "value", read: true, write: false, def: 0 },
		},
		{
			id: AI_STATES.limitWarning,
			common: {
				name: "KI-Tageslimit fast erreicht (≥80%)",
				type: "boolean",
				role: "indicator.warning",
				read: true,
				write: false,
				def: false,
			},
		},
		{
			id: AI_STATES.costEstimateTodayEur,
			common: {
				name: "KI-Kostenschätzung heute (EUR, ungefähr)",
				type: "number",
				role: "value",
				read: true,
				write: false,
				def: 0,
				unit: "EUR",
			},
		},
		{
			id: AI_STATES.lastRunAt,
			common: { name: "Letzter KI-Lauf", type: "string", role: "date", read: true, write: false, def: "" },
		},
		{
			id: AI_STATES.lastAutoTriggerAtMs,
			common: {
				name: "Letzter automatischer KI-Trigger (Unix-ms, intern — Mindestabstand)",
				type: "number",
				role: "value",
				read: true,
				write: false,
				def: 0,
			},
		},
		{
			id: AI_STATES.lastRunResult,
			common: { name: "Letztes KI-Ergebnis", type: "string", role: "text", read: true, write: false, def: "" },
		},
		{
			id: AI_STATES.lastReasonDe,
			common: { name: "Letzte KI-Begründung", type: "string", role: "text", read: true, write: false, def: "" },
		},
		{
			id: AI_STATES.lastError,
			common: { name: "Letzter KI-Fehler", type: "string", role: "text", read: true, write: false, def: "" },
		},
		{
			id: AI_STATES.lastSlotPreferencesJson,
			common: {
				name: "Letzte KI-Zeitpunkt-Präferenzen (JSON, intern — Basis für Plan-Vergleich)",
				type: "string",
				role: "json",
				read: true,
				write: false,
				def: "[]",
			},
		},
		{
			id: AI_STATES.optimizeNowRequest,
			common: {
				name: "Jetzt optimieren anfordern",
				type: "boolean",
				role: "button",
				read: true,
				write: true,
				def: false,
			},
		},
	];
	await ensureStates(host, defs);
}
