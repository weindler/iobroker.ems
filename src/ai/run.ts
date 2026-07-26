import type { DailyPlan } from "../operator/daily_plan/types";
import { aiConfigFromAdapter } from "./config";
import { buildAiOptimizationContext, resolveAllowedAddonIds, type ContextHost } from "./context";
import { AI_STATES } from "./ensure_states";
import { readAndRolloverDailyCalls, recordDailyCall, type LimiterHost } from "./limiter";
import { estimateCostEur } from "./pricing";
import type { AiProvider, AiStatus } from "./types";
import { clearAiAutoSuspend, finalizeAiRunWithWritebackGate, type WritebackHost } from "./writeback";

export type AiRunHost = ContextHost &
	LimiterHost &
	WritebackHost & {
		log?: { debug?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void };
	};

export interface AiRunOutcome {
	ran: boolean;
	status: AiStatus;
	reasonDe: string;
}

async function writeStatus(host: AiRunHost, status: AiStatus): Promise<void> {
	await host.setStateAsync(AI_STATES.status, { val: status, ack: true });
}

/**
 * Orchestriert genau einen KI-Optimierungsversuch (Roadmap Block 6).
 * Fail-closed: ohne messbaren Plan-B-Vorteil kein Write-back, Auto-Trigger gesperrt.
 * Write-back geht nur über Daily-Plan-Allocation — nie direkt auf Geräte.
 */
export async function runAiOptimizationNow(
	host: AiRunHost,
	plan: DailyPlan,
	triggerReason: string,
	provider: AiProvider,
): Promise<AiRunOutcome> {
	const cfg = aiConfigFromAdapter(host.config);

	if (!cfg.enabled) {
		await writeStatus(host, "off");
		return { ran: false, status: "off", reasonDe: "KI global deaktiviert." };
	}

	if (!cfg.apiKey) {
		await writeStatus(host, "no_token");
		return { ran: false, status: "no_token", reasonDe: "Kein API-Token hinterlegt." };
	}

	const allowedAddonIds = resolveAllowedAddonIds(host.config);
	if (allowedAddonIds.length === 0) {
		await writeStatus(host, "no_addons_allowed");
		return { ran: false, status: "no_addons_allowed", reasonDe: "Kein Add-on hat KI-Optimierung erlaubt." };
	}

	const limitState = await readAndRolloverDailyCalls(
		host,
		cfg.maxCallsPerDay,
		new Date(),
		cfg.monthlyCostLimitEur,
	);
	if (limitState.limitReached) {
		await writeStatus(host, "limit_reached");
		const reason = limitState.monthlyLimitReached
			? `Monatslimit erreicht (${limitState.costMonthEur.toFixed(3)}/${limitState.monthlyLimitEur} EUR).`
			: `Tageslimit erreicht (${limitState.callsToday}/${limitState.limit}).`;
		return { ran: false, status: "limit_reached", reasonDe: reason };
	}

	// Manueller Lauf darf Auto-Suspend aufheben und erneut prüfen.
	if (triggerReason === "manual") {
		await clearAiAutoSuspend(host);
	}

	const context = await buildAiOptimizationContext(host, plan, triggerReason);

	let result;
	try {
		result = await provider.optimize(context, { apiKey: cfg.apiKey, model: cfg.model, timeoutMs: 20_000 });
	} catch (e) {
		result = {
			ok: false as const,
			proposals: [],
			slotPreferences: [],
			reasonDe: "Unerwarteter Fehler beim KI-Aufruf.",
			usage: { promptTokens: null, completionTokens: null },
			error: String(e instanceof Error ? e.message : e),
		};
	}

	const costEur = estimateCostEur(cfg.model, result.usage.promptTokens, result.usage.completionTokens);
	await recordDailyCall(host, cfg.maxCallsPerDay, costEur, new Date(), cfg.monthlyCostLimitEur);

	const nowIso = new Date().toISOString();
	await host.setStateAsync(AI_STATES.lastRunAt, { val: nowIso, ack: true });
	await host.setStateAsync(AI_STATES.lastReasonDe, { val: result.reasonDe.slice(0, 480), ack: true });

	if (!result.ok) {
		await host.setStateAsync(AI_STATES.lastRunResult, { val: "error", ack: true });
		await host.setStateAsync(AI_STATES.lastError, { val: String(result.error ?? "").slice(0, 480), ack: true });
		await host.setStateAsync(AI_STATES.lastSlotPreferencesJson, { val: "[]", ack: true });
		await writeStatus(host, "error");
		host.log?.warn?.(`KI-Optimierung fehlgeschlagen (${triggerReason}): ${result.error ?? result.reasonDe}`);
		return { ran: true, status: "error", reasonDe: result.reasonDe };
	}

	await host.setStateAsync(AI_STATES.lastRunResult, { val: "ok", ack: true });
	await host.setStateAsync(AI_STATES.lastError, { val: "", ack: true });
	await host.setStateAsync(AI_STATES.lastSlotPreferencesJson, {
		val: JSON.stringify(result.slotPreferences),
		ack: true,
	});

	const gate = await finalizeAiRunWithWritebackGate(host, plan, result.slotPreferences);
	if (gate.suspended) {
		await writeStatus(host, "suspended");
		const reason = gate.compare.delta.decisionReasonDe;
		await host.setStateAsync(AI_STATES.lastReasonDe, { val: reason.slice(0, 480), ack: true });
		host.log?.warn?.(`KI ohne Plan-B-Vorteil — Auto aus: ${reason}`);
		return { ran: true, status: "suspended", reasonDe: reason };
	}

	await writeStatus(host, "ready");
	const wbNote = gate.writebackApplied ? "Write-back aktiv." : "kein Write-back nötig.";
	host.log?.debug?.(
		`KI-Optimierung (${triggerReason}): ${result.slotPreferences.length} Slot-Präferenz(en), ${wbNote} — ${result.reasonDe}`,
	);
	return {
		ran: true,
		status: "ready",
		reasonDe: gate.writebackApplied
			? `${result.reasonDe} Write-back auf Allocation angewendet.`
			: result.reasonDe,
	};
}
