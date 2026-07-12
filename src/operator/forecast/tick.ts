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
import { serializeForecastPlanForWrites } from "./serialization";
import {
	readForecastPlanFile,
	writeForecastPlanFile,
	type PlanPathHost,
} from "../plan_store";
import { FORECAST_PLAN_STATE_IDS } from "./states";
import type { ForecastPlan } from "./types";

let lastRevisionPayload = "";
let revision = 0;

export type ForecastPlanTickOptions = {
	/** When true, plan_json persistence runs after adapter ready (see flushDeferredForecastPlanWrites). */
	deferLargeJsonWrites?: boolean;
	/** Skip bootstrap cache and always rebuild. */
	forceRebuild?: boolean;
	/** When false, compute plan in memory only — no file/scalar persistence. */
	persistToDb?: boolean;
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

	let planRaw = await readForecastPlanFile(host as PlanPathHost);
	let migratedFromState = false;
	if (!isBootstrapForecastPlanJson(planRaw)) {
		planRaw = await readStr(host, FORECAST_PLAN_STATE_IDS.planJson);
		migratedFromState = isBootstrapForecastPlanJson(planRaw);
	}
	if (!isBootstrapForecastPlanJson(planRaw)) return null;

	const plan = parseForecastPlanFromJson(planRaw);
	if (!isUsableStoredForecastPlan(plan)) return null;

	if (migratedFromState && planRaw) {
		void writeForecastPlanFile(host as PlanPathHost, planRaw).catch((e) => {
			host.log?.warn?.(`forecast plan file migration: ${String(e)}`);
		});
	}

	const storedRevision = await readNum(host, FORECAST_PLAN_STATE_IDS.revision);
	if (storedRevision !== null && storedRevision >= 0) {
		plan!.revision = storedRevision;
		revision = storedRevision;
	}
	lastRevisionPayload = forecastPlanRevisionPayload(plan!);
	return plan;
}

async function storedPlanSemanticallyMatches(
	host: ContributionsReadHost,
	plan: ForecastPlan,
	semanticHash: string,
): Promise<boolean> {
	const storedHash = await readStr(host, FORECAST_PLAN_STATE_IDS.semanticRevisionHash);
	if (storedHash === semanticHash) return true;
	const raw =
		(await readForecastPlanFile(host as PlanPathHost)) ??
		(await readStr(host, FORECAST_PLAN_STATE_IDS.planJson));
	const stored = parseForecastPlanFromJson(raw);
	if (!stored) return false;
	return forecastPlanSemanticRevisionHash(stored) === semanticHash;
}

function scheduleFirstInstallForecastPersist(
	host: ContributionsReadHost,
	plan: ForecastPlan,
	semanticHash: string,
	nextRevision: number,
): void {
	scheduleDeferredForecastPlanWrite(host, async () => {
		await persistForecastPlan(host, plan, semanticHash, nextRevision);
	});
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

/** Persist forecast plan — full JSON to atomic file; scalars only in ioBroker states. */
async function persistForecastPlan(
	host: ContributionsReadHost,
	plan: ForecastPlan,
	semanticHash: string,
	nextRevision: number,
): Promise<void> {
	const serialized = serializeForecastPlanForWrites(plan);

	if (await storedPlanSemanticallyMatches(host, plan, semanticHash)) {
		(host.log as MemoryProbeLogger | undefined)?.info?.(
			"forecast plan persist: semantically unchanged — skip file write",
		);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, undefined, false);
		if ((await readStr(host, FORECAST_PLAN_STATE_IDS.semanticRevisionHash)) !== semanticHash) {
			await writeScalarState(
				host,
				FORECAST_PLAN_STATE_IDS.semanticRevisionHash,
				semanticHash,
				undefined,
				true,
			);
		}
		lastRevisionPayload = forecastPlanRevisionPayload(plan);
		return;
	}

	const planBytes = utf8Bytes(serialized.planJson);
	logForecastPlanDuplicationReport(host.log as MemoryProbeLogger | undefined, {
		revisionChanged: true,
		semanticHash,
		fields: [
			{
				stateId: "forecast_plan.json",
				bytes: planBytes,
				slotCount: plan.slots.length,
				contributionCount: plan.contributions.length,
			},
		],
		totalSerializedBytes: planBytes,
		uniqueSlotBytes: serialized.report.uniqueSlotBytes,
		uniqueContributionBytes: serialized.report.uniqueContributionBytes,
		duplicateSlotBytesVsPlanJson: 0,
		duplicateContributionBytesVsPlanJson: 0,
	});

	(host.log as MemoryProbeLogger | undefined)?.info?.(
		`forecast plan file write: bytes=${planBytes} slots=${plan.slots.length}`,
	);
	await writeForecastPlanFile(host as PlanPathHost, serialized.planJson);

	await writeScalarState(host, FORECAST_PLAN_STATE_IDS.status, plan.status, undefined, true);
	await writeScalarState(host, FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, undefined, false);
	await writeScalarState(host, FORECAST_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "", undefined, true);
	await writeScalarState(host, FORECAST_PLAN_STATE_IDS.horizonStart, plan.horizonStart, undefined, false);
	await writeScalarState(host, FORECAST_PLAN_STATE_IDS.horizonEnd, plan.horizonEnd, undefined, true);
	await writeScalarState(host, FORECAST_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes, undefined, true);
	await writeScalarState(host, FORECAST_PLAN_STATE_IDS.reasonDe, plan.reasonDe, undefined, true);
	await writeScalarState(host, FORECAST_PLAN_STATE_IDS.revision, nextRevision, undefined, true);
	await writeScalarState(host, FORECAST_PLAN_STATE_IDS.semanticRevisionHash, semanticHash, undefined, true);

	revision = nextRevision;
	lastRevisionPayload = forecastPlanRevisionPayload(plan);
	plan.revision = nextRevision;
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
				`forecast plan bootstrap: cached plan file revision=${cached.revision} slots=${cached.slots.length} — skip rebuild (periodic tick refreshes)`,
			);
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

	if (!resolution.skipLargeJsonWrites && resolution.revisionChanged) {
		if (await storedPlanSemanticallyMatches(host, plan, semanticHash)) {
			resolution = {
				...resolution,
				skipLargeJsonWrites: true,
				deferLargeJsonWrites: false,
				skipReason: "semantic_plan_match",
			};
		}
	}

	(host.log as MemoryProbeLogger | undefined)?.info?.(
		[
			"forecast plan write decision:",
			`revisionChanged=${resolution.revisionChanged}`,
			`skipLargeJson=${resolution.skipLargeJsonWrites}`,
			`deferLargeJson=${resolution.deferLargeJsonWrites && !resolution.skipLargeJsonWrites}`,
			`persistToDb=${options.persistToDb !== false}`,
			`skipReason=${resolution.skipReason}`,
			`storedHash=${resolution.storedHash?.slice(0, 12) ?? "none"}`,
			`computedHash=${semanticHash.slice(0, 12)}`,
		].join(" "),
	);

	if (options.persistToDb === false) {
		revision = resolution.nextRevision;
		lastRevisionPayload = semanticPayload;
		plan.revision = resolution.nextRevision;
		return plan;
	}

	if (deferLargeJsonWrites && !options.forceRebuild) {
		scheduleFirstInstallForecastPersist(host, plan, semanticHash, resolution.nextRevision);
		(host.log as MemoryProbeLogger | undefined)?.info?.(
			`forecast plan bootstrap: built_in_memory revision=${plan.revision} — defer file persist until adapter ready`,
		);
		revision = resolution.nextRevision;
		lastRevisionPayload = semanticPayload;
		return plan;
	}

	try {
		if (resolution.skipLargeJsonWrites) {
			await writeScalarState(host, FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, undefined, false);
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
		} else {
			await persistForecastPlan(host, plan, semanticHash, resolution.nextRevision);
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
