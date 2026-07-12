import { captureMemoryProbe, type MemoryProbeLogger, type MemoryProbeSnapshot } from "./memory_probe";

export interface ForecastPlanWriteProbeMeta {
	stateId: string;
	revisionRequired: boolean;
	skipRead: boolean;
	slotCount?: number;
	contributionCount?: number;
	duplicateSlotsVsPlanJson?: number;
	duplicateContributionsVsPlanJson?: number;
}

function utf8Bytes(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function formatProbeLine(
	phase: string,
	meta: ForecastPlanWriteProbeMeta,
	snapshot: MemoryProbeSnapshot,
	extra?: Record<string, number | string | boolean | undefined>,
): string {
	const parts = [
		`EMS mem-forecast-write[${meta.stateId}]`,
		`phase=${phase}`,
		`bytes=${extra?.bytes ?? ""}`,
		`revisionRequired=${meta.revisionRequired}`,
		`skipRead=${meta.skipRead}`,
		meta.slotCount !== undefined ? `slots=${meta.slotCount}` : null,
		meta.contributionCount !== undefined ? `contributions=${meta.contributionCount}` : null,
		meta.duplicateSlotsVsPlanJson !== undefined ? `dupSlotsVsPlan=${meta.duplicateSlotsVsPlanJson}` : null,
		meta.duplicateContributionsVsPlanJson !== undefined
			? `dupContribVsPlan=${meta.duplicateContributionsVsPlanJson}`
			: null,
		`rss=${snapshot.rssMiB}MiB`,
		`heapUsed=${snapshot.heapUsedMiB}MiB`,
		`external=${snapshot.externalMiB}MiB`,
		`arrayBuffers=${snapshot.arrayBuffersMiB}MiB`,
	].filter((p) => p !== null && !p.endsWith("="));
	return parts.join(" ");
}

export function logForecastPlanWriteProbe(
	log: MemoryProbeLogger | undefined,
	phase: string,
	meta: ForecastPlanWriteProbeMeta,
	extra?: Record<string, number | string | boolean | undefined>,
): MemoryProbeSnapshot {
	const snapshot = captureMemoryProbe(`forecast_write:${meta.stateId}:${phase}`);
	log?.info?.(formatProbeLine(phase, meta, snapshot, extra));
	return snapshot;
}

export function logForecastPlanDuplicationReport(
	log: MemoryProbeLogger | undefined,
	report: {
		revisionChanged: boolean;
		semanticHash: string;
		fields: Array<{
			stateId: string;
			bytes: number;
			slotCount?: number;
			contributionCount?: number;
		}>;
		totalSerializedBytes: number;
		uniqueSlotBytes: number;
		uniqueContributionBytes: number;
		duplicateSlotBytesVsPlanJson: number;
		duplicateContributionBytesVsPlanJson: number;
	},
): void {
	const lines = [
		`EMS mem-forecast-dup revisionChanged=${report.revisionChanged} semanticHash=${report.semanticHash.slice(0, 12)}`,
		`totalSerializedBytes=${report.totalSerializedBytes}`,
		`uniqueSlotBytes=${report.uniqueSlotBytes}`,
		`uniqueContributionBytes=${report.uniqueContributionBytes}`,
		`duplicateSlotBytesVsPlanJson=${report.duplicateSlotBytesVsPlanJson}`,
		`duplicateContributionBytesVsPlanJson=${report.duplicateContributionBytesVsPlanJson}`,
		...report.fields.map(
			(f) =>
				`  ${f.stateId} bytes=${f.bytes}` +
				(f.slotCount !== undefined ? ` slots=${f.slotCount}` : "") +
				(f.contributionCount !== undefined ? ` contributions=${f.contributionCount}` : ""),
		),
	];
	for (const line of lines) {
		log?.info?.(line);
	}
}

export { utf8Bytes };
