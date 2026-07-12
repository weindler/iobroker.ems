import {
	logForecastPlanDuplicationReport,
	utf8Bytes,
} from "../../diagnostics/forecast_plan_write_probe";
import type { MemoryProbeLogger } from "../../diagnostics/memory_probe";
import { isBootstrapComplete } from "../../bootstrap/barrier";
import { setStateIfChanged } from "../../policy/core/state_write";
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
import { FLEXIBLE_CONTRIBUTIONS_STATE_IDS } from "../contributions/flexible/states";
import { GRID_SUPPLY_STATE_IDS } from "../supply/grid_states";
import { FORECAST_PLAN_STATE_IDS } from "./states";
import type { ForecastPlan } from "./types";

let lastRevisionPayload = "";
let revision = 0;
let lastInputFingerprint = "";
let lastLearningFingerprint = "";
let cachedPeriodicPlan: ForecastPlan | null = null;

async function learningInputFingerprint(host: ContributionsReadHost): Promise<string> {
	const [pvUpd, houseUpd, weatherUpd] = await Promise.all([
		readStr(host, "learning.pv_bias.last_update_ts"),
		readStr(host, "learning.house_load.last_update"),
		readStr(host, "learning.weather.last_update"),
	]);
	return [pvUpd, houseUpd, weatherUpd].join("|");
}

/** Full fingerprint incl. grid/flex revision — for logging only. */
async function forecastInputFingerprint(host: ContributionsReadHost): Promise<string> {
	const [gridRev, flexRev, learning] = await Promise.all([
		readNum(host, GRID_SUPPLY_STATE_IDS.revision),
		readNum(host, FLEXIBLE_CONTRIBUTIONS_STATE_IDS.revision),
		learningInputFingerprint(host),
	]);
	return [gridRev, flexRev, learning].join("|");
}

async function loadPlanFromFile(host: ContributionsReadHost): Promise<ForecastPlan | null> {
	const planRaw = await readForecastPlanFile(host as PlanPathHost);
	if (!isBootstrapForecastPlanJson(planRaw)) return null;
	const plan = parseForecastPlanFromJson(planRaw);
	if (!isUsableStoredForecastPlan(plan)) return null;
	return plan;
}

function rememberPeriodicPlan(plan: ForecastPlan, fullFingerprint: string, learningFingerprint: string): void {
	lastInputFingerprint = fullFingerprint;
	lastLearningFingerprint = learningFingerprint;
	cachedPeriodicPlan = plan;
	lastRevisionPayload = forecastPlanRevisionPayload(plan);
	revision = plan.revision;
}

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
	lastInputFingerprint = "";
	lastLearningFingerprint = "";
	cachedPeriodicPlan = null;
	clearDeferredForecastPlanWriteForTest();
}

export function forecastPlanRevisionForTest(): number {
	return revision;
}

/** True when learning timestamps differ from last primed/skipped baseline. */
export async function peekLearningInputsChanged(host: ContributionsReadHost): Promise<boolean> {
	const learningFp = await learningInputFingerprint(host);
	return lastLearningFingerprint !== "" && learningFp !== lastLearningFingerprint;
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
	if (semanticPayload === lastRevisionPayload && lastRevisionPayload !== "") {
		return {
			revisionChanged: false,
			nextRevision: revision,
			skipLargeJsonWrites: true,
			deferLargeJsonWrites: false,
			skipReason: "memory_cache",
			storedHash: semanticHash,
		};
	}

	const filePlan = await loadPlanFromFile(host);
	if (filePlan) {
		const fileHash = forecastPlanSemanticRevisionHash(filePlan);
		if (fileHash === semanticHash) {
			lastRevisionPayload = semanticPayload;
			revision = filePlan.revision;
			return {
				revisionChanged: false,
				nextRevision: revision,
				skipLargeJsonWrites: true,
				deferLargeJsonWrites: false,
				skipReason: "file_hash_match",
				storedHash: fileHash,
			};
		}
	}

	const storedHash = await readStr(host, FORECAST_PLAN_STATE_IDS.semanticRevisionHash);
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
	const raw = await readForecastPlanFile(host as PlanPathHost);
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

/** Persist forecast plan — atomic file only (no ioBroker JSON/scalar writes; avoids native RSS spike). */
async function persistForecastPlan(
	host: ContributionsReadHost,
	plan: ForecastPlan,
	semanticHash: string,
	nextRevision: number,
): Promise<void> {
	const serialized = serializeForecastPlanForWrites(plan);
	const existingFile = await readForecastPlanFile(host as PlanPathHost);
	if (existingFile === serialized.planJson) {
		(host.log as MemoryProbeLogger | undefined)?.info?.(
			"forecast plan persist: file bytes unchanged — skip write",
		);
		lastRevisionPayload = forecastPlanRevisionPayload(plan);
		return;
	}

	if (await storedPlanSemanticallyMatches(host, plan, semanticHash)) {
		(host.log as MemoryProbeLogger | undefined)?.info?.(
			"forecast plan persist: semantically unchanged — skip file write",
		);
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
			const learningFp = await learningInputFingerprint(host);
			const fullFp = await forecastInputFingerprint(host);
			rememberPeriodicPlan(cached, fullFp, learningFp);
			return cached;
		}
	}

	const learningFp = await learningInputFingerprint(host);
	const fullFp = await forecastInputFingerprint(host);
	const learningChanged = lastLearningFingerprint !== "" && learningFp !== lastLearningFingerprint;
	// Interval ticks pass persistToDb=false; persist file only when learning inputs actually changed.
	const persistToDb = options.persistToDb !== false || learningChanged;
	if (isBootstrapComplete() && !options.forceRebuild && !learningChanged && lastLearningFingerprint !== "") {
		if (cachedPeriodicPlan) {
			(host.log as MemoryProbeLogger | undefined)?.info?.(
				`forecast plan periodic: learning unchanged — skip rebuild (revision=${cachedPeriodicPlan.revision}, grid/flex may have ticked)`,
			);
			lastInputFingerprint = fullFp;
			return cachedPeriodicPlan;
		}
		const fromFile = await loadPlanFromFile(host);
		if (fromFile) {
			(host.log as MemoryProbeLogger | undefined)?.info?.(
				`forecast plan periodic: loaded file revision=${fromFile.revision} — skip rebuild`,
			);
			rememberPeriodicPlan(fromFile, fullFp, learningFp);
			return fromFile;
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
			`persistToDb=${persistToDb}`,
			`skipReason=${resolution.skipReason}`,
			`storedHash=${resolution.storedHash?.slice(0, 12) ?? "none"}`,
			`computedHash=${semanticHash.slice(0, 12)}`,
		].join(" "),
	);

	if (persistToDb === false) {
		revision = resolution.nextRevision;
		lastRevisionPayload = semanticPayload;
		plan.revision = resolution.nextRevision;
		rememberPeriodicPlan(plan, fullFp, learningFp);
		return plan;
	}

	if (deferLargeJsonWrites && !options.forceRebuild) {
		scheduleFirstInstallForecastPersist(host, plan, semanticHash, resolution.nextRevision);
		(host.log as MemoryProbeLogger | undefined)?.info?.(
			`forecast plan bootstrap: built_in_memory revision=${plan.revision} — defer file persist until adapter ready`,
		);
		revision = resolution.nextRevision;
		lastRevisionPayload = semanticPayload;
		plan.revision = resolution.nextRevision;
		rememberPeriodicPlan(plan, fullFp, learningFp);
		return plan;
	}

	try {
		if (resolution.skipLargeJsonWrites) {
			revision = resolution.nextRevision;
			lastRevisionPayload = semanticPayload;
			plan.revision = resolution.nextRevision;
		} else {
			await persistForecastPlan(host, plan, semanticHash, resolution.nextRevision);
		}
		rememberPeriodicPlan(plan, fullFp, learningFp);
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

/** After learning init — align skip fingerprints with post-learning state (planner ran earlier). */
export async function primeForecastPeriodicCache(host: ContributionsReadHost): Promise<void> {
	const fromFile = await loadPlanFromFile(host);
	if (!fromFile) return;
	const learningFp = await learningInputFingerprint(host);
	const fullFp = await forecastInputFingerprint(host);
	rememberPeriodicPlan(fromFile, fullFp, learningFp);
	(host.log as MemoryProbeLogger | undefined)?.info?.(
		`forecast plan cache primed: revision=${fromFile.revision} slots=${fromFile.slots.length}`,
	);
}
