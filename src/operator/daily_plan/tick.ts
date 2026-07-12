import { globalPolicyConfigFromAdapter } from "../../policy/global/config";
import type { PolicySnapshot } from "../../policy/core/types";
import { intentAdminConfigFromAdapter } from "../../intent/config";
import { plannerModePolicyFromGlobalMode } from "../../planner/mode_policy";
import { setStateIfChanged } from "../../policy/core/state_write";
import type { ForecastPlan } from "../forecast/types";
import { buildDailyPlanFromForecast } from "./build";
import {
	dailyPlanRevisionPayload,
	dailyPlanSemanticRevisionHash,
	parseDailyPlanFromJson,
} from "./revision";
import { ALLOCATION_ADDON_STATE_IDS, DAILY_PLAN_STATE_IDS } from "./states";
import type { DailyPlan } from "./types";
import type { ContributionsReadHost } from "../contributions/read";

export type DailyPlanTickOptions = {
	/** When false, build in memory only — no ioBroker state writes. */
	persistToDb?: boolean;
};

let lastRevisionPayload = "";
let revision = 0;

export function resetDailyPlanRevisionForTest(): void {
	lastRevisionPayload = "";
	revision = 0;
}

export function dailyPlanRevisionForTest(): number {
	return revision;
}

async function readStr(host: ContributionsReadHost, relId: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(relId);
		if (st?.val == null || st.val === "") return null;
		return String(st.val);
	} catch {
		return null;
	}
}

async function readNum(host: ContributionsReadHost, relId: string): Promise<number | null> {
	const raw = await readStr(host, relId);
	if (raw === null) return null;
	const n = parseFloat(raw);
	return Number.isFinite(n) ? n : null;
}

async function readEffectivePolicy(host: ContributionsReadHost): Promise<PolicySnapshot | null> {
	const raw = await readStr(host, "policy.global.effective_json");
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PolicySnapshot;
	} catch {
		return null;
	}
}

function policyBool(snapshot: PolicySnapshot | null, key: string): boolean | null {
	const entry = snapshot?.economics?.[key];
	if (!entry || entry.value === null || typeof entry.value !== "boolean") return null;
	return entry.value;
}

function policyNumber(snapshot: PolicySnapshot | null, key: string): number | null {
	const entry = snapshot?.limits?.[key];
	if (!entry || entry.value === null) return null;
	const n = typeof entry.value === "number" ? entry.value : parseFloat(String(entry.value));
	return Number.isFinite(n) ? n : null;
}

function policyStringArray(snapshot: PolicySnapshot | null, key: string): string[] | null {
	const entry = snapshot?.preferences?.[key];
	if (!entry || !Array.isArray(entry.value)) return null;
	return entry.value.filter((v): v is string => typeof v === "string");
}

function addonAllocationSummary(plan: DailyPlan, addonPrefix: string) {
	const allocations = plan.allocations.filter(
		(a) =>
			a.contributionId === addonPrefix ||
			a.contributionId.startsWith(`${addonPrefix}.`) ||
			(a.contributor.id === addonPrefix && addonPrefix !== "air_conditioning"),
	);
	if (addonPrefix === "air_conditioning") {
		return plan.allocations.filter((a) => a.contributionId.startsWith("air_conditioning."));
	}
	return allocations;
}

async function storedDailyPlanSemanticallyMatches(
	host: ContributionsReadHost,
	plan: DailyPlan,
	semanticHash: string,
): Promise<boolean> {
	const storedHash = await readStr(host, DAILY_PLAN_STATE_IDS.semanticRevisionHash);
	if (storedHash === semanticHash) return true;
	const raw = await readStr(host, DAILY_PLAN_STATE_IDS.planJson);
	const stored = parseDailyPlanFromJson(raw);
	if (!stored) return false;
	return dailyPlanSemanticRevisionHash(stored) === semanticHash;
}

async function persistDailyPlan(
	host: ContributionsReadHost,
	plan: DailyPlan,
	semanticHash: string,
	nextRevision: number,
): Promise<void> {
	const planJson = JSON.stringify(plan);
	if ((await readStr(host, DAILY_PLAN_STATE_IDS.planJson)) === planJson) {
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.generatedAt, plan.generatedAt);
		if ((await readStr(host, DAILY_PLAN_STATE_IDS.semanticRevisionHash)) !== semanticHash) {
			await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.semanticRevisionHash, semanticHash);
		}
		lastRevisionPayload = dailyPlanRevisionPayload(plan);
		return;
	}

	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.status, plan.status);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.generatedAt, plan.generatedAt);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "");
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.date, plan.date);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.globalMode, plan.globalMode);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.planJson, planJson);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.reasonDe, plan.reasonDe);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.revision, nextRevision);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.semanticRevisionHash, semanticHash);

	const addonSummaries: Array<{ key: keyof typeof ALLOCATION_ADDON_STATE_IDS; prefix: string }> = [
		{ key: "battery", prefix: "battery" },
		{ key: "wallbox", prefix: "wallbox" },
		{ key: "immersion_heater", prefix: "immersion_heater" },
		{ key: "air_conditioning", prefix: "air_conditioning" },
	];

	for (const { key, prefix } of addonSummaries) {
		const ids = ALLOCATION_ADDON_STATE_IDS[key];
		const summary = addonAllocationSummary(plan, prefix);
		const status = summary.length > 0 ? "ready" : "idle";
		await setStateIfChanged(host, ids.status, status);
		await setStateIfChanged(host, ids.planJson, JSON.stringify(summary));
		await setStateIfChanged(
			host,
			ids.reasonDe,
			summary.length > 0
				? `${summary.length} Allocation-Einträge für ${prefix}.`
				: `Keine Allocation für ${prefix}.`,
		);
	}

	revision = nextRevision;
	lastRevisionPayload = dailyPlanRevisionPayload(plan);
	plan.revision = nextRevision;
}

export async function runDailyPlanTick(
	host: ContributionsReadHost,
	forecastPlan: ForecastPlan,
	options: DailyPlanTickOptions = {},
): Promise<DailyPlan> {
	const now = new Date();
	const adminCfg = intentAdminConfigFromAdapter(host.config);
	const timezone = adminCfg.timezone || "Europe/Berlin";
	const globalModeRaw = (await readStr(host, "global_modes.active")) ?? "balanced";
	const modePolicy = plannerModePolicyFromGlobalMode(globalModeRaw);
	const adminPolicy = globalPolicyConfigFromAdapter(host.config);
	const effectivePolicy = await readEffectivePolicy(host);

	const energyPriority =
		policyStringArray(effectivePolicy, "energyPriority") ?? adminPolicy.energyPriority ?? [];
	const mutualRaw = effectivePolicy?.protection?.mutualExclusions?.value;
	const mutualExclusions = Array.isArray(mutualRaw)
		? (mutualRaw as Array<{ id: string; addonA: string; addonB: string; reason?: string }>)
		: adminPolicy.mutualExclusions ?? [];

	const plan = buildDailyPlanFromForecast(now, timezone, modePolicy.mode, forecastPlan, {
		policySnapshot: effectivePolicy as unknown as Record<string, unknown> | null,
		energyPriority,
		mutualExclusions,
		gridImportAllowedPolicy:
			policyBool(effectivePolicy, "gridImportAllowed") ?? adminPolicy.gridImportAllowed,
		effectiveMaxGridImportW: policyNumber(effectivePolicy, "maxGridImportW") ?? adminPolicy.maxGridImportW,
		configuredHouseFuseLimitW:
			policyNumber(effectivePolicy, "houseFuseLimitW") ?? adminPolicy.houseFuseLimitW,
		modePolicy,
	});

	const semanticPayload = dailyPlanRevisionPayload(plan);
	const semanticHash = dailyPlanSemanticRevisionHash(plan);

	let revisionChanged = semanticPayload !== lastRevisionPayload;
	if (!revisionChanged && lastRevisionPayload !== "") {
		plan.revision = revision;
		return plan;
	}

	const storedRevision = await readNum(host, DAILY_PLAN_STATE_IDS.revision);
	if (storedRevision !== null && storedRevision >= 0 && revision === 0) {
		revision = storedRevision;
	}

	if (options.persistToDb === false) {
		const nextRevision = revisionChanged ? revision + 1 : revision;
		plan.revision = nextRevision;
		if (revisionChanged) {
			revision = nextRevision;
			lastRevisionPayload = semanticPayload;
		}
		return plan;
	}

	if (await storedDailyPlanSemanticallyMatches(host, plan, semanticHash)) {
		plan.revision = revision;
		lastRevisionPayload = semanticPayload;
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.generatedAt, plan.generatedAt);
		return plan;
	}

	const nextRevision = revisionChanged ? revision + 1 : revision;
	plan.revision = nextRevision;

	(host.log as { info?: (msg: string) => void } | undefined)?.info?.(
		[
			"daily plan write decision:",
			`revisionChanged=${revisionChanged}`,
			`storedHash=${((await readStr(host, DAILY_PLAN_STATE_IDS.semanticRevisionHash)) ?? "none").slice(0, 12)}`,
			`computedHash=${semanticHash.slice(0, 12)}`,
		].join(" "),
	);

	try {
		await persistDailyPlan(host, plan, semanticHash, nextRevision);
	} catch (e) {
		host.log?.warn?.(`daily plan state write: ${String(e)}`);
		try {
			await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.status, "error");
			await setStateIfChanged(
				host,
				DAILY_PLAN_STATE_IDS.reasonDe,
				`Daily Plan Fehler: ${String(e)}`.slice(0, 480),
			);
		} catch {
			// ignore
		}
	}

	return plan;
}
