import { numbersSemanticallyEqual } from "./canonize";
import type { DualRunCompareResult, NormalizedPlannerPlan } from "./types";

function pushMismatch(
	out: Array<{ path: string; domain: string }>,
	path: string,
	domain: string,
): void {
	out.push({ path, domain });
}

/**
 * Semantic compare of normalized plans.
 * Distinguishes not_comparable (identity/horizon) from mismatch (content).
 */
export function compareNormalizedPlans(
	authoritative: NormalizedPlannerPlan,
	candidate: NormalizedPlannerPlan,
): DualRunCompareResult {
	if (authoritative.schemaVersion !== candidate.schemaVersion) {
		return {
			status: "not_comparable",
			mismatchCount: 1,
			mismatchedSlotCount: 0,
			firstMismatchDomain: "schema",
			firstMismatchPath: "schemaVersion",
			authoritativeRevision: authoritative.semanticRevision,
			candidateRevision: candidate.semanticRevision,
		};
	}
	if (
		authoritative.horizon.start !== candidate.horizon.start ||
		authoritative.horizon.end !== candidate.horizon.end ||
		authoritative.horizon.slotMinutes !== candidate.horizon.slotMinutes
	) {
		return {
			status: "not_comparable",
			mismatchCount: 1,
			mismatchedSlotCount: 0,
			firstMismatchDomain: "horizon",
			firstMismatchPath: "horizon",
			authoritativeRevision: authoritative.semanticRevision,
			candidateRevision: candidate.semanticRevision,
		};
	}
	if (authoritative.validationStatus === "failed" || candidate.validationStatus === "failed") {
		if (authoritative.validationStatus === candidate.validationStatus) {
			// both failed identically — still compare content below
		} else {
			return {
				status: "validation_failed",
				mismatchCount: 1,
				mismatchedSlotCount: 0,
				firstMismatchDomain: "validation",
				firstMismatchPath: "validationStatus",
				authoritativeRevision: authoritative.semanticRevision,
				candidateRevision: candidate.semanticRevision,
			};
		}
	}

	const mismatches: Array<{ path: string; domain: string }> = [];
	if (authoritative.forecastStatus !== candidate.forecastStatus) {
		pushMismatch(mismatches, "forecastStatus", "forecast");
	}
	if (authoritative.dailyStatus !== candidate.dailyStatus) {
		pushMismatch(mismatches, "dailyStatus", "daily");
	}

	const slotCount = Math.max(authoritative.slots.length, candidate.slots.length);
	let mismatchedSlotCount = 0;
	for (let i = 0; i < slotCount; i++) {
		const a = authoritative.slots[i];
		const b = candidate.slots[i];
		const before = mismatches.length;
		if (!a || !b) {
			pushMismatch(mismatches, `slots[${i}]`, "horizon");
		} else {
			if (a.start !== b.start || a.end !== b.end) {
				pushMismatch(mismatches, `slots[${i}].bounds`, "horizon");
			}
			if (!numbersSemanticallyEqual(a.pvPowerW, b.pvPowerW, "power_w")) {
				pushMismatch(mismatches, `slots[${i}].pvPowerW`, "forecast");
			}
			if (!numbersSemanticallyEqual(a.houseLoadPowerW, b.houseLoadPowerW, "power_w")) {
				pushMismatch(mismatches, `slots[${i}].houseLoadPowerW`, "forecast");
			}
			if (!numbersSemanticallyEqual(a.fixedBalancePowerW, b.fixedBalancePowerW, "power_w")) {
				pushMismatch(mismatches, `slots[${i}].fixedBalancePowerW`, "forecast");
			}
			if (!numbersSemanticallyEqual(a.gridPriceCtPerKwh, b.gridPriceCtPerKwh, "price_ct")) {
				pushMismatch(mismatches, `slots[${i}].gridPriceCtPerKwh`, "price");
			}
			if (a.gridImportAllowed !== b.gridImportAllowed) {
				pushMismatch(mismatches, `slots[${i}].gridImportAllowed`, "constraint");
			}
			if (!numbersSemanticallyEqual(a.gridMaxImportPowerW, b.gridMaxImportPowerW, "power_w")) {
				pushMismatch(mismatches, `slots[${i}].gridMaxImportPowerW`, "constraint");
			}
		}
		if (mismatches.length > before) mismatchedSlotCount += 1;
	}

	const allocCount = Math.max(authoritative.allocations.length, candidate.allocations.length);
	for (let i = 0; i < allocCount; i++) {
		const a = authoritative.allocations[i];
		const b = candidate.allocations[i];
		if (!a || !b) {
			pushMismatch(mismatches, `allocations[${i}]`, "allocation");
			continue;
		}
		if (a.contributionId !== b.contributionId) {
			pushMismatch(mismatches, `allocations[${i}].contributionId`, "allocation");
		}
		if (a.slotStart !== b.slotStart || a.slotEnd !== b.slotEnd) {
			pushMismatch(mismatches, `allocations[${i}].slot`, "allocation");
		}
		if (!numbersSemanticallyEqual(a.powerW, b.powerW, "power_w")) {
			pushMismatch(mismatches, `allocations[${i}].powerW`, "allocation");
		}
		if (!numbersSemanticallyEqual(a.energyKwh, b.energyKwh, "energy_kwh")) {
			pushMismatch(mismatches, `allocations[${i}].energyKwh`, "allocation");
		}
		if (a.status !== b.status) {
			pushMismatch(mismatches, `allocations[${i}].status`, "allocation");
		}
	}

	const totalsKeys: Array<keyof NormalizedPlannerPlan["totals"]> = [
		"flexibleAllocatedEnergyKwh",
		"flexibleUnallocatedEnergyKwh",
		"pvForecastEnergyKwh",
		"fixedHouseLoadEnergyKwh",
	];
	for (const key of totalsKeys) {
		if (!numbersSemanticallyEqual(authoritative.totals[key], candidate.totals[key], "energy_kwh")) {
			pushMismatch(mismatches, `totals.${key}`, "totals");
		}
	}

	if (mismatches.length === 0) {
		return {
			status: "matched",
			mismatchCount: 0,
			mismatchedSlotCount: 0,
			authoritativeRevision: authoritative.semanticRevision,
			candidateRevision: candidate.semanticRevision,
		};
	}
	return {
		status: "mismatch",
		mismatchCount: mismatches.length,
		mismatchedSlotCount,
		firstMismatchDomain: mismatches[0]?.domain,
		firstMismatchPath: mismatches[0]?.path,
		authoritativeRevision: authoritative.semanticRevision,
		candidateRevision: candidate.semanticRevision,
	};
}
