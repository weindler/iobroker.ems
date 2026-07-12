import {
	logForecastPlanDuplicationReport,
	logForecastPlanWriteProbe,
	utf8Bytes,
} from "../../diagnostics/forecast_plan_write_probe";
import type { MemoryProbeLogger } from "../../diagnostics/memory_probe";
import { setStateIfChanged, type StateWriteOptions } from "../../policy/core/state_write";
import type { StateHost } from "../../ems_light/state_util";
import { collectContributions, type ContributionsReadHost } from "../contributions/read";
import type { PlanContribution } from "../types";
import type { GridSupplyForecast } from "../types";
import { buildForecastPlan } from "./build";
import {
	forecastPlanRevisionPayload,
	forecastPlanSemanticRevisionHash,
} from "./revision";
import { serializeForecastPlanForWrites } from "./serialization";
import { FORECAST_PLAN_STATE_IDS } from "./states";
import type { ForecastPlan } from "./types";

let lastRevisionPayload = "";
let revision = 0;

export function resetForecastPlanRevisionForTest(): void {
	lastRevisionPayload = "";
	revision = 0;
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

async function resolveForecastRevisionChange(
	host: ContributionsReadHost,
	semanticPayload: string,
	semanticHash: string,
): Promise<{ revisionChanged: boolean; nextRevision: number }> {
	if (semanticPayload === lastRevisionPayload && lastRevisionPayload !== "") {
		return { revisionChanged: false, nextRevision: revision };
	}

	const storedHash = await readStr(host, FORECAST_PLAN_STATE_IDS.semanticRevisionHash);
	if (storedHash === semanticHash) {
		lastRevisionPayload = semanticPayload;
		const storedRevision = await readNum(host, FORECAST_PLAN_STATE_IDS.revision);
		if (storedRevision !== null && storedRevision >= 0) {
			revision = storedRevision;
		}
		return { revisionChanged: false, nextRevision: revision };
	}

	return {
		revisionChanged: true,
		nextRevision: revision + 1,
	};
}

/** @internal test hook */
export async function resolveForecastRevisionChangeForTest(
	host: ContributionsReadHost,
	semanticPayload: string,
	semanticHash: string,
): Promise<{ revisionChanged: boolean; nextRevision: number }> {
	return resolveForecastRevisionChange(host, semanticPayload, semanticHash);
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
	writeOpts: StateWriteOptions | undefined,
	revisionRequired: boolean,
	counts?: { slotCount?: number; contributionCount?: number },
	dup?: { duplicateSlotsVsPlanJson?: number; duplicateContributionsVsPlanJson?: number },
): Promise<void> {
	const bytes = utf8Bytes(json);
	const meta = {
		stateId,
		revisionRequired,
		skipRead: writeOpts?.skipRead === true,
		slotCount: counts?.slotCount,
		contributionCount: counts?.contributionCount,
		duplicateSlotsVsPlanJson: dup?.duplicateSlotsVsPlanJson,
		duplicateContributionsVsPlanJson: dup?.duplicateContributionsVsPlanJson,
	};
	logForecastPlanWriteProbe(host.log as MemoryProbeLogger | undefined, "before_payload", meta);
	logForecastPlanWriteProbe(host.log as MemoryProbeLogger | undefined, "after_stringify", meta, { bytes });
	logForecastPlanWriteProbe(host.log as MemoryProbeLogger | undefined, "before_setState", meta, { bytes });
	await setStateIfChanged(host, stateId, json, writeOpts);
	logForecastPlanWriteProbe(host.log as MemoryProbeLogger | undefined, "after_setState", meta, { bytes });
}

export async function runForecastPlanTick(
	host: ContributionsReadHost,
	gridForecast?: GridSupplyForecast,
	flexibleContributions: PlanContribution[] = [],
): Promise<ForecastPlan> {
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
	const { revisionChanged, nextRevision } = await resolveForecastRevisionChange(host, semanticPayload, semanticHash);
	plan.revision = nextRevision;
	const writeOpts: StateWriteOptions | undefined = revisionChanged ? { skipRead: true } : undefined;

	try {
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.status, plan.status, writeOpts, revisionChanged);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, undefined, false);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "", writeOpts, revisionChanged);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.horizonStart, plan.horizonStart, undefined, false);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.horizonEnd, plan.horizonEnd, writeOpts, revisionChanged);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes, writeOpts, revisionChanged);

		if (revisionChanged) {
			const serialized = serializeForecastPlanForWrites(plan);
			logForecastPlanDuplicationReport(host.log as MemoryProbeLogger | undefined, {
				revisionChanged,
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

			await writeJsonState(
				host,
				FORECAST_PLAN_STATE_IDS.activeContributorsJson,
				serialized.activeContributorsJson,
				writeOpts,
				true,
			);
			await writeJsonState(
				host,
				FORECAST_PLAN_STATE_IDS.excludedContributorsJson,
				serialized.excludedContributorsJson,
				writeOpts,
				true,
			);
			await writeJsonState(host, FORECAST_PLAN_STATE_IDS.daysJson, serialized.daysJson, writeOpts, true);
			await writeJsonState(
				host,
				FORECAST_PLAN_STATE_IDS.slotsJson,
				serialized.slotsJson,
				writeOpts,
				true,
				{ slotCount: plan.slots.length },
			);
			await writeJsonState(
				host,
				FORECAST_PLAN_STATE_IDS.contributionsJson,
				serialized.contributionsJson,
				writeOpts,
				true,
				{ contributionCount: plan.contributions.length },
			);
			await writeJsonState(
				host,
				FORECAST_PLAN_STATE_IDS.planJson,
				serialized.planJson,
				writeOpts,
				true,
				{ slotCount: plan.slots.length, contributionCount: plan.contributions.length },
				{
					duplicateSlotsVsPlanJson: serialized.report.duplicateSlotBytesVsPlanJson,
					duplicateContributionsVsPlanJson: serialized.report.duplicateContributionBytesVsPlanJson,
				},
			);
		}

		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.reasonDe, plan.reasonDe, writeOpts, revisionChanged);
		await writeScalarState(host, FORECAST_PLAN_STATE_IDS.revision, nextRevision, writeOpts, revisionChanged);
		// Persist semantic hash only after all other writes succeeded.
		await writeScalarState(
			host,
			FORECAST_PLAN_STATE_IDS.semanticRevisionHash,
			semanticHash,
			writeOpts,
			revisionChanged,
		);

		if (revisionChanged) {
			revision = nextRevision;
			lastRevisionPayload = semanticPayload;
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
