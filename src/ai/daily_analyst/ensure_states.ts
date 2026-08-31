import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";
import { aiAnalystConfigFromAdapter, type AiAnalystAdminConfig } from "./config";

function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}
function numState(id: string, name: string): StateDef {
	return { id, common: { name, type: "number", role: "value", read: true, write: false, def: 0 } };
}
function boolState(id: string, name: string, opts: { write?: boolean; def?: boolean; role?: string } = {}): StateDef {
	return {
		id,
		common: {
			name,
			type: "boolean",
			role: opts.role ?? "indicator",
			read: true,
			write: opts.write ?? false,
			def: opts.def ?? false,
		},
		defaultVal: opts.def ?? false,
		setDefaultIfEmpty: true,
	};
}

const BASE = "ai.daily_analyst";

export const AI_ANALYST_STATES = {
	modeEffective: `${BASE}.mode_effective`,
	enabled: `${BASE}.enabled`,
	status: `${BASE}.status`,
	lastRunAtIso: `${BASE}.last_run_at`,
	lastRunDateKey: `${BASE}.last_run_date_key`,
	reasonDe: `${BASE}.reason_de`,
	lastError: `${BASE}.last_error`,
	findingsCount: `${BASE}.findings_count`,
	topFindingDe: `${BASE}.top_finding_de`,
	runNowRequest: `${BASE}.run_now_request`,
} as const;

export async function ensureAiDailyAnalystStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "ai.daily_analyst", "KI Daily Analyst (Phase 4) — reine Analyse, kein Regler");
	const defs: StateDef[] = [
		strState(AI_ANALYST_STATES.modeEffective, "KI Daily Analyst Modus (effektiv)", "disabled"),
		boolState(AI_ANALYST_STATES.enabled, "KI Daily Analyst aktiv"),
		strState(AI_ANALYST_STATES.status, "KI Daily Analyst Status", "disabled"),
		strState(AI_ANALYST_STATES.lastRunAtIso, "KI Daily Analyst letzter Lauf (ISO)"),
		strState(AI_ANALYST_STATES.lastRunDateKey, "KI Daily Analyst letzter analysierter Tag"),
		strState(AI_ANALYST_STATES.reasonDe, "KI Daily Analyst Status/Begründung", "KI Daily Analyst deaktiviert."),
		strState(AI_ANALYST_STATES.lastError, "KI Daily Analyst letzter Fehler", ""),
		numState(AI_ANALYST_STATES.findingsCount, "KI Daily Analyst Findings letzter Tag"),
		strState(AI_ANALYST_STATES.topFindingDe, "KI Daily Analyst wichtigstes Finding", ""),
		boolState(AI_ANALYST_STATES.runNowRequest, "KI Daily Analyst jetzt analysieren (manuell)", {
			write: true,
			role: "button",
		}),
	];
	await ensureStates(host, defs);
}

async function publish(host: StateHost, id: string, val: ioBroker.StateValue): Promise<void> {
	try {
		await host.setStateAsync(id, { val, ack: true });
	} catch {
		/* Status-States sind best-effort */
	}
}

function idleReasonDe(mode: AiAnalystAdminConfig["mode"]): string {
	if (mode === "manual") {
		return "Bereit — manueller Lauf über „Jetzt analysieren“.";
	}
	if (mode === "daily_auto") {
		return "Bereit — automatische Tagesanalyse aktiv.";
	}
	return "KI Daily Analyst deaktiviert.";
}

/**
 * Schreibt enabled/mode_effective (und status, falls er zum Admin-Modus nicht passt)
 * aus der nativen Adapter-Config. Ohne diesen Schritt bleiben die Ensure-Defaults
 * (`disabled`/`false`) nach Speichern/Neustart stehen, weil kein Analyst-Lauf nötig war.
 */
export async function syncAiDailyAnalystRuntimeFromConfig(
	host: StateHost & { config?: unknown },
): Promise<AiAnalystAdminConfig> {
	await ensureAiDailyAnalystStates(host);
	const cfg = aiAnalystConfigFromAdapter(host.config);
	await publish(host, AI_ANALYST_STATES.modeEffective, cfg.mode);
	await publish(host, AI_ANALYST_STATES.enabled, cfg.mode !== "disabled");

	const curStatus = String((await host.getStateAsync(AI_ANALYST_STATES.status))?.val ?? "");
	if (cfg.mode === "disabled") {
		await publish(host, AI_ANALYST_STATES.status, "disabled");
		const curReason = String((await host.getStateAsync(AI_ANALYST_STATES.reasonDe))?.val ?? "");
		if (curStatus !== "disabled" || !curReason) {
			await publish(host, AI_ANALYST_STATES.reasonDe, idleReasonDe("disabled"));
		}
	} else if (curStatus === "disabled" || curStatus === "") {
		await publish(host, AI_ANALYST_STATES.status, "idle");
		await publish(host, AI_ANALYST_STATES.reasonDe, idleReasonDe(cfg.mode));
	}
	return cfg;
}

/** Hängenden Button (true) nach Restart leeren — kein stiller Lauf. */
export async function clearStaleDailyAnalystRunNowRequest(host: {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
}): Promise<boolean> {
	const st = await host.getStateAsync(AI_ANALYST_STATES.runNowRequest);
	if (st?.val !== true) {
		return false;
	}
	await host.setStateAsync(AI_ANALYST_STATES.runNowRequest, { val: false, ack: true });
	return true;
}
