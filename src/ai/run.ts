import type { DailyPlan } from "../operator/daily_plan/types";
import { aiConfigFromAdapter, AI_DEFAULT_TIMEOUT_MS, AI_THINKING_TIMEOUT_MS } from "./config";
import { buildAiOptimizationContext, resolveAllowedAddonIds, type ContextHost } from "./context";
import { AI_STATES } from "./ensure_states";
import { readAndRolloverDailyCalls, recordDailyCall, type LimiterHost } from "./limiter";
import { estimateCostEur } from "./pricing";
import {
	decisionsToSlotPreferences,
	normalizeAddonDecisions,
	wallboxPvOnlyFromDecisions,
} from "./strategy_preferences";
import type { AiProvider, AiStatus } from "./types";
import {
	currentAiEnableEpoch,
	isAiPublishAllowed,
	readAiUserEnabled,
} from "./user_enabled";
import { clearAiAutoSuspend, finalizeAiRunWithWritebackGate, type WritebackHost } from "./writeback";

export type AiRunHost = ContextHost &
	LimiterHost &
	WritebackHost & {
		log?: {
			debug?: (m: string) => void;
			info?: (m: string) => void;
			warn?: (m: string) => void;
			error?: (m: string) => void;
		};
	};

export interface AiRunOutcome {
	ran: boolean;
	status: AiStatus;
	reasonDe: string;
}

async function writeStatus(host: AiRunHost, status: AiStatus): Promise<void> {
	await host.setStateAsync(AI_STATES.status, { val: status, ack: true });
}

async function persistThinkingStates(
	host: AiRunHost,
	thinkingDe: string,
	decisionsJson: string,
	thinkingMode: boolean,
): Promise<void> {
	await host.setStateAsync(AI_STATES.lastThinkingDe, { val: thinkingDe.slice(0, 1200), ack: true });
	await host.setStateAsync(AI_STATES.lastDecisionsJson, { val: decisionsJson, ack: true });
	await host.setStateAsync(AI_STATES.lastThinkingMode, { val: thinkingMode, ack: true });
}

/**
 * Orchestriert genau einen KI-Optimierungsversuch (Roadmap Block 6 / denkende KI).
 * Fail-closed: ohne messbaren Plan-B-Vorteil kein Write-back, Auto-Trigger gesperrt
 * — aber nur wenn Slot-Präferenzen vorhanden sind. Reines Denken bleibt sichtbar (ready).
 * Write-back geht nur über Daily-Plan-Allocation — nie direkt auf Geräte.
 */
export async function runAiOptimizationNow(
	host: AiRunHost,
	plan: DailyPlan,
	triggerReason: string,
	provider: AiProvider,
): Promise<AiRunOutcome> {
	const cfg = aiConfigFromAdapter(host.config);
	const requestEpoch = currentAiEnableEpoch();

	if (!(await readAiUserEnabled(host))) {
		await writeStatus(host, "off");
		return { ran: false, status: "off", reasonDe: "KI deaktiviert (ai.user_enabled)." };
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

	const tz =
		typeof (host.config as { timezone?: unknown })?.timezone === "string" &&
		(host.config as { timezone: string }).timezone.trim()
			? (host.config as { timezone: string }).timezone.trim()
			: "Europe/Berlin";
	const limitState = await readAndRolloverDailyCalls(
		host,
		cfg.maxCallsPerDay,
		new Date(),
		cfg.monthlyCostLimitEur,
		tz,
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
	const timeoutMs = cfg.thinkingMode ? AI_THINKING_TIMEOUT_MS : AI_DEFAULT_TIMEOUT_MS;

	let result;
	try {
		result = await provider.optimize(context, {
			apiKey: cfg.apiKey,
			model: cfg.model,
			timeoutMs,
			thinkingMode: cfg.thinkingMode,
		});
	} catch (e) {
		result = {
			ok: false as const,
			proposals: [],
			slotPreferences: [],
			thinkingDe: "",
			decisions: [],
			reasonDe: "Unerwarteter Fehler beim KI-Aufruf.",
			usage: { promptTokens: null, completionTokens: null },
			error: String(e instanceof Error ? e.message : e),
		};
	}

	// Publish-Guard: Toggle während Request → Ergebnis verwerfen (auch nach erneutem ON).
	if (!(await isAiPublishAllowed(host, requestEpoch))) {
		const costEurDiscard = estimateCostEur(
			cfg.model,
			result.usage.promptTokens,
			result.usage.completionTokens,
		);
		await recordDailyCall(host, cfg.maxCallsPerDay, costEurDiscard, new Date(), cfg.monthlyCostLimitEur, tz);
		host.log?.info?.(
			`KI-Ergebnis verworfen (${triggerReason}): user_enabled/epoch ungültig (requestEpoch=${requestEpoch}, now=${currentAiEnableEpoch()}).`,
		);
		return {
			ran: false,
			status: "off",
			reasonDe: "KI während Request deaktiviert — Ergebnis verworfen.",
		};
	}

	const costEur = estimateCostEur(cfg.model, result.usage.promptTokens, result.usage.completionTokens);
	await recordDailyCall(host, cfg.maxCallsPerDay, costEur, new Date(), cfg.monthlyCostLimitEur, tz);

	const nowIso = new Date().toISOString();
	await host.setStateAsync(AI_STATES.lastRunAt, { val: nowIso, ack: true });
	await host.setStateAsync(AI_STATES.lastReasonDe, { val: result.reasonDe.slice(0, 480), ack: true });

	const decisions = cfg.thinkingMode
		? normalizeAddonDecisions(result.decisions, context.situation)
		: [];
	const thinkingDe = cfg.thinkingMode ? result.thinkingDe : "";
	await persistThinkingStates(host, thinkingDe, JSON.stringify(decisions), cfg.thinkingMode);

	if (!result.ok) {
		await host.setStateAsync(AI_STATES.lastRunResult, { val: "error", ack: true });
		await host.setStateAsync(AI_STATES.lastError, { val: String(result.error ?? "").slice(0, 480), ack: true });
		await host.setStateAsync(AI_STATES.lastSlotPreferencesJson, { val: "[]", ack: true });
		await writeStatus(host, "error");
		host.log?.warn?.(`KI-Optimierung fehlgeschlagen (${triggerReason}): ${result.error ?? result.reasonDe}`);
		return { ran: true, status: "error", reasonDe: result.reasonDe };
	}

	const mergedPrefs = cfg.thinkingMode
		? decisionsToSlotPreferences(plan, decisions, result.slotPreferences)
		: result.slotPreferences;

	await host.setStateAsync(AI_STATES.lastRunResult, { val: "ok", ack: true });
	await host.setStateAsync(AI_STATES.lastError, { val: "", ack: true });
	await host.setStateAsync(AI_STATES.lastSlotPreferencesJson, {
		val: JSON.stringify(mergedPrefs),
		ack: true,
	});

	if (!(await isAiPublishAllowed(host, requestEpoch))) {
		host.log?.info?.(`KI-Publish abgebrochen vor Compare (${triggerReason}): epoch/user_enabled ungültig.`);
		return {
			ran: false,
			status: "off",
			reasonDe: "KI während Request deaktiviert — Ergebnis verworfen.",
		};
	}

	const wallboxPvOnly = wallboxPvOnlyFromDecisions(decisions);
	const gate = await finalizeAiRunWithWritebackGate(host, plan, mergedPrefs, {
		wallboxPvOnly,
		skipAutoSuspend: cfg.thinkingMode,
	});
	if (gate.suspended) {
		await writeStatus(host, "suspended");
		const reason = gate.compare.delta.decisionReasonDe;
		await host.setStateAsync(AI_STATES.lastReasonDe, { val: reason.slice(0, 480), ack: true });
		host.log?.warn?.(`KI ohne Plan-B-Vorteil — Auto aus: ${reason}`);
		return { ran: true, status: "suspended", reasonDe: reason };
	}

	await writeStatus(host, "ready");
	const noWbReason = gate.compare.delta.decisionReasonDe;
	const thinkingSummary =
		!gate.writebackApplied && thinkingDe
			? `${thinkingDe.slice(0, 320)}${mergedPrefs.length > 0 ? ` | ${noWbReason}` : ""}`.slice(0, 480)
			: result.reasonDe;
	const reasonDe = gate.writebackApplied
		? `${result.reasonDe} Write-back auf Allocation angewendet.`
		: gate.planBPreferred
			? `${result.reasonDe} Plan B advisory (Unified bleibt autoritativ).`.slice(0, 480)
			: thinkingSummary;
	await host.setStateAsync(AI_STATES.lastReasonDe, { val: reasonDe.slice(0, 480), ack: true });
	const wbNote = gate.writebackApplied
		? "Write-back aktiv."
		: gate.planBPreferred
			? "Plan B advisory."
			: "kein Write-back.";
	host.log?.debug?.(
		`KI-Optimierung (${triggerReason}): ${mergedPrefs.length} Slot-Präferenz(en), ${decisions.length} Decision(s), ${wbNote} — ${reasonDe}`,
	);
	return {
		ran: true,
		status: "ready",
		reasonDe,
	};
}
