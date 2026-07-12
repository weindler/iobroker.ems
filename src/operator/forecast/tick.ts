import {
	logForecastPlanDuplicationReport,
	logForecastPlanWriteProbe,
	utf8Bytes,
} from "../../diagnostics/forecast_plan_write_probe";
import type { MemoryProbeLogger } from "../../diagnostics/memory_probe";
import { isBootstrapComplete } from "../../bootstrap/barrier";
import { setStateIfChanged, type StateWriteOptions } from "../../policy/core/state_write";
import type { StateHost } from "../../ems_light/state_util";
import { collectContributions, type ContributionsReadHost } from "../contributions/read";
import type { PlanContribution } from "../types";
import type { GridSupplyForecast } from "../types";
import { buildForecastPlan } from "./build";
import {
	forecastPlanRevisionPayload,
	forecastPlanSemanticRevisionHash,
	isBootstrapForecastPlanJson,
	isUsableStoredForecastPlan,
	parseForecastPlanFromJson,
} from "./revision";
import {
	clearDeferredForecastPlanWriteForTest,
	scheduleDeferredForecastPlanWrite,
} from "./deferred_writes";
import { serializeForecastPlanForWrites, type ForecastPlanSerializedWrites } from "./serialization";
import { FORECAST_PLAN_STATE_IDS } from "./states";
import type { ForecastPlan } from "./types";

let lastRevisionPayload = "";
let revision = 0;

export type ForecastPlanTickOptions = {
	/** When true, large JSON mirror writes run after adapter ready (see flushDeferredForecastPlanWrites). */
	deferLargeJsonWrites?: boolean;
	/** Skip bootstrap cache and always rebuild (deferred refresh after adapter ready). */
	forceRebuild?: boolean;
};

export function resetForecastPlanRevisionForTest(): void {
	lastRevisionPayload = "";
	revision = 0;
	clearDeferredForecastPlanWriteForTest();
}

export function forecastPlanRevisionForTest(): number {
	return revision;
}

async function readStr(host: StateHost, relId: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(relId);
		if (st?.val == null || st.val === "") return null;
		return String(st.val);
	} catch {
		return null;
	}
}

async function readNum(host: StateHost, relId: string): Promise<number | null> {
	const raw = await readStr(host, relId);
	if (raw === null) return null;
	const n = parseFloat(raw);
	return Number.isFinite(n) ? n : null;
}

type RevisionResolution = {
	revisionChanged: boolean;
	nextRevision: number;
	skipLargeJsonWrites: boolean;
	deferLargeJsonWrites: boolean;
	skipReason: string;
	storedHash: string | null;
};

async function resolveForecastRevisionChange(
	host: ContributionsReadHost,
	semanticPayload: string,
	semanticHash: string,
	deferLargeJsonWrites: boolean,
): Promise<RevisionResolution> {
	const storedHash = await readStr(host, FORECAST_PLAN_STATE_IDS.semanticRevisionHash);

	if (semanticPayload === lastRevisionPayload && lastRevisionPayload !== "") {
		return {
			revisionChanged: false,
			nextRevision: revision,
			skipLargeJsonWrites: true,
			deferLargeJsonWrites: false,
			skipReason: "memory_cache",
			storedHash,
		};
	}

	if (storedHash === semanticHash) {
		lastRevisionPayload = semanticPayload;
		const storedRevision = await readNum(host, FORECAST_PLAN_STATE_IDS.revision);
		if (storedRevision !== null && storedRevision >= 0) {
			revision = storedRevision;
		}
		return {
			revisionChanged: false,
			nextRevision: revision,
			skipLargeJsonWrites: true,
			deferLargeJsonWrites: false,
			skipReason: "stored_hash_match",
			storedHash,
		};
	}

	return {
		revisionChanged: true,
		nextRevision: revision + 1,
		skipLargeJsonWrites: false,
		deferLargeJsonWrites: deferLargeJsonWrites,
		skipReason: "semantic_hash_changed",
		storedHash,
	};
}

/** @internal test hook */
export async function resolveForecastRevisionChangeForTest(
	host: ContributionsReadHost,
	semanticPayload: string,
	semanticHash: string,
	deferLargeJsonWrites = false,
): Promise<RevisionResolution> {
	return resolveForecastRevisionChange(host, semanticPayload, semanticHash, deferLargeJsonWrites);
}

async function loadCachedForecastPlanForBootstrap(host: ContributionsReadHost): Promise<ForecastPlan | null> {
	const statusRaw = await readStr(host, FORECAST_PLAN_STATE_IDS.status);
	if (!statusRaw || statusRaw === "not_initialized") return null;

	const planRaw = await readStr(host, FORECAST_PLAN_STATE_IDS.planJson);
	if (!isBootstrapForecastPlanJson(planRaw)) return null;

	const plan = parseForecastPlanFromJson(planRaw);
	if (!isUsableStoredForecastPlan(plan)) return null;

	const storedRevision = await readNum(host, FORECAST_PLAN_STATE_IDS.revision);
	if (storedRevision !== null && storedRevision >= 0) {
		plan!.revision = storedRevision;
		revision = storedRevision;
	}
	lastRevisionPayload = forecastPlanRevisionPayload(plan!);
	return plan;
}

function scheduleBootstrapForecastRefresh(
	host: ContributionsReadHost,
	gridForecast: GridSupplyForecast | undefined,
	flexibleContributions: PlanContribution[],
): void {
	scheduleDeferredForecastPlanWrite(host, async () => {
		await runForecastPlanTick(host, gridForecast, flexibleContributions, {
			deferLargeJsonWrites: false,
			forceRebuild: true,
		});
	});
}

async function allMirrorJsonMatches(
	host: ContributionsReadHost,
	serialized: ForecastPlanSerializedWrites,
): Promise<boolean> {
	const pairs: Array<[string, string]> = [
		[FORECAST_PLAN_STATE_IDS.activeContributorsJson, serialized.activeContributorsJson],
		[FORECAST_PLAN_STATE_IDS.excludedContributorsJson, serialized.excludedContributorsJson],
		[FORECAST_PLAN_STATE_IDS.daysJson, serialized.daysJson],
		[FORECAST_PLAN_STATE_IDS.slotsJson, serialized.slotsJson],
		[FORECAST_PLAN_STATE_IDS.contributionsJson, serialized.contributionsJson],
		[FORECAST_PLAN_STATE_IDS.planJson, serialized.planJson],
	];
	for (const [stateId, json] of pairs) {
		const stored = await readStr(host, stateId);
		if (stored !== json) return false;
	}
	return true;
}

async function writeScalarState(
	host: ContributionsReadHost,
	stateId: string,
	val: ioBroker.StateValue,
	writeOpts: StateWriteOptions | undefined,
	revisionRequired: boolean,
): Promise<void> {
	const meta = {
		stateId,
		revisionRequired,
		skipRead: writeOpts?.skipRead === true,
	};
	logForecastPlanWriteProbe(host.log as MemoryProbeLogger | undefined, "before_write", meta);
	await setStateIfChanged(host, stateId, val, writeOpts);
	logForecastPlanWriteProbe(host.log as MemoryProbeLogger | undefined, "after_write", meta);
}

async function writeJsonState(
	host: ContributionsReadHost,
	stateId: string,
	json: string,
	revisionRequired: boolean,
	counts?: { slotCount?: number; contributionCount?: number },
	dup?: { duplicateSlotsVsPlanJson?: number; duplicateContributionsVsPlanJson?: number },
): Promise<void> {
	const bytes = utf8Bytes(json);
	const meta = {
		stateId,
		revisionRequired,
		skipRead: false,
		slotCount: counts?.slotCount,
		contributionCount: counts?.contributionCount,
		duplicateSlotsVsPlanJson: dup?.duplicateSlotsVsPlanJson,
		duplicateContributionsVsPlanJson: dup?.duplicateContributionsVsPlanJson,
	};
	logForecastPlanWriteProbe(host.log as MemoryProbeLogger | undefined, "before_payload", meta);
	logForecastPlanWriteProbe(host.log as MemoryProbeLogger | undefined, "after_stringify", meta, { bytes });
	logForecastPlanWriteProbe(host.log as MemoryProbeLogger | undefined, "before_setState", meta, { bytes });
	await setStateIfChanged(host, stateId, json);
	logForecastPlanWriteProbe(host.log as MemoryProbeLogger | undefined, "after_setState", meta, { bytes });
}

async function writeLargeJsonStates(
	host: ContributionsReadHost,
	plan: ForecastPlan,
	serialized: ForecastPlanSerializedWrites,
	semanticHash: string,
	nextRevision: number,
): Promise<void> {
	logForecastPlanDuplicationReport(host.log as MemoryProbeLogger | undefined, {
		revisionChanged: true,
		semanticHash,
		fields: serialized.report.fields.map((f) => ({
			stateId: f.stateId,
			bytes: f.bytes,
			slotCount: f.slotCount,
			contributionCount: f.contributionCount,
		})),
		totalSerializedBytes: serialized.report.totalSerializedBytes,
		uniqueSlotBytes: serialized.report.uniqueSlotBytes,
		uniqueContributionBytes: serialized.report.uniqueContributionBytes,
		duplicateSlotBytesVsPlanJson: serialized.report.duplicateSlotBytesVsPlanJson,
		duplicateContributionBytesVsPlanJson: serialized.report.duplicateContributionBytesVsPlanJson,
	});

	await writeJsonState(host, FORECAST_PLAN_STATE_IDS.activeContributorsJson, serialized.activeContributorsJson, true);
	await writeJsonState(
		host,
		FORECAST_PLAN_STATE_IDS.excludedContributorsJson,
		serialized.excludedContributorsJson,
		true,
	);
	await writeJsonState(host, FORECAST_PLAN_STATE_IDS.daysJson, serialized.daysJson, true);
	await writeJsonState(
		host,
		FORECAST_PLAN_STATE_IDS.slotsJson,
		serialized.slotsJson,
		true,
		{ slotCount: plan.slots.length },
	);
	await writeJsonState(
		host,
		FORECAST_PLAN_STATE_IDS.contributionsJson,
		serialized.contributionsJson,
		true,
		{ contributionCount: plan.contributions.length },
	);
	await writeJsonState(
		host,
		FORECAST_PLAN_STATE_IDS.planJson,
		serialized.planJson,
		true,
		{ slotCount: plan.slots.length, contributionCount: plan.contributions.length },
		{
			duplicateSlotsVsPlanJson: serialized.report.duplicateSlotBytesVsPlanJson,
			duplicateContributionsVsPlanJson: serialized.report.duplicateContributionBytesVsPlanJson,
		},
	);

	await writeScalarState(host, FORECAST_PLAN_STATE_IDS.revision, nextRevision, undefined, true);
	await writeScalarState(host, FORECAST_PLAN_STATE_IDS.semanticRevisionHash, semanticHash, undefined, true);

	revision = nextRevision;
	lastRevisionPayload = forecastPlanRevisionPayload(plan);
}

export async function runForecastPlanTick(
	host: ContributionsReadHost,
	gridForecast?: GridSupplyForecast,
	flexibleContributions: PlanContribution[] = [],
	options: ForecastPlanTickOptions = {},
): Promise<ForecastPlan> {
	const deferLargeJsonWrites = options.deferLargeJsonWrites ?? !isBootstrapComplete();

	if (deferLargeJsonWrites && !options.forceRebuild) {
		const cached = await loadCachedForecastPlanForBootstrap(host);
		if (cached) {
			(host.log as MemoryProbeLogger | undefined)?.info?.(
				`forecast plan bootstrap: cached plan_json revision=${cached.revision} slots=${cached.slots.length} — skip rebuild`,
			);
			scheduleBootstrapForecastRefresh(host, gridForecast, flexibleContributions);
			return cached;
		}
	}

	const now = new Date();
	const collected = await collectContributions(host, now, gridForecast);
	const contributions = [...collected.contributions, ...flexibleContributions];
	const plan = buildForecastPlan({
		now,
		timezone: collected.timezone,
		contributions,
	});

	const semanticPayload = forecastPlanRevisionPayload(plan);
	const semanticHash = forecastPlanSemanticRevisionHash(plan);

	let resolution = await resolveForecastRevisionChange(host, semanticPayload, semanticHash, deferLargeJsonWrites);
	plan.revision = resolution.nextRevision;

	let serialized: ForecastPlanSerializedWrites | null = null;
	if (
		!resolution.skipLargeJsonWrites &&
		resolution.revisionChanged &&
		!resolution.deferLargeJsonWrites
	) {
		serialized = serializeForecastPlanForWrites(plan);
		if (await allMirrorJsonMatches(host, serialized)) {
			resolution = {
				...resolution,
				skipLargeJsonWrites: true,
				deferLargeJsonWrites: false,
				skipReason: "mirror_json_match",
			};
		}
	}

	(host.log as MemoryProbeLogger | undefined)?.info?.(
		[
			"forecast plan write decision:",
			`revisionChanged=${resolution.revisionChanged}`,
			`skipLargeJson=${resolution.skipLargeJsonWrites}`,
			`deferLargeJson=${resolution.deferLargeJsonWrites && !resolution.skipLargeJsonWrites}`,
			`skipReason=${resolution.skipReason}`,
			`storedHash=${resolution.storedHash?.slice(0, 12) ?? "none"}`,
			`computedHash=${semanticHash.slice(0, 12)}`,
		].join(" "),
	);

	if (deferLargeJsonWrites && !options.forceRebuild) {
		scheduleBootstrapForecastRefresh(host, gridForecast, flexibleContributions);
		(host.log as MemoryProbeLogger | undefined)?.info?.(
			`forecast plan bootstrap: built_in_memory revision=${plan.revision} — defer all DB writes until adapter ready`,
		);
		revision = resolution.nextRevision;
		lastRevisionPayload = semanticPayload;
		return plan;
	}

	try {
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.status, plan.status, undefined, resolution.revisionChanged);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, undefined, false);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "", undefined, resolution.revisionChanged);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.horizonStart, plan.horizonStart, undefined, false);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.horizonEnd, plan.horizonEnd, undefined, resolution.revisionChanged);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes, undefined, resolution.revisionChanged);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.reasonDe, plan.reasonDe, undefined, resolution.revisionChanged);

		if (resolution.skipLargeJsonWrites) {
			if (resolution.storedHash !== semanticHash) {
				await writeScalarState(
					host,
					FORECAST_PLAN_STATE_IDS.semanticRevisionHash,
					semanticHash,
					undefined,
					true,
				);
			}
			if (resolution.revisionChanged) {
				await writeScalarState(host, FORECAST_PLAN_STATE_IDS.revision, resolution.nextRevision, undefined, true);
				revision = resolution.nextRevision;
				lastRevisionPayload = semanticPayload;
			}
		} else if (serialized) {
			await writeLargeJsonStates(host, plan, serialized, semanticHash, resolution.nextRevision);
		}
	} catch (e) {
		host.log?.warn?.(`forecast plan state write: ${String(e)}`);
		try {
			await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.status, "error");
			await setStateIfChanged(
				host,
				FORECAST_PLAN_STATE_IDS.reasonDe,
				`Forecast Plan Fehler: ${String(e)}`.slice(0, 480),
			);
		} catch {
			// ignore secondary failure
		}
	}

	return plan;
}
