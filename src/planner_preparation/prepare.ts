import { buildGridSupplyForecast } from "../grid_supply/forecast";
import type { GridSupplyBuildInput } from "../grid_supply/forecast";
import type { PlannerInputSnapshot } from "../planner_snapshot/types";
import { globalConstraintsStatus, houseFuseConstraintStatus } from "./constraint_diagnostics";
import { computePreparationRevision } from "./canonical";
import type { PlannerPreparedInput, PlannerPreparedSlot } from "./types";

/** Maps snapshot fields to the neutral grid-supply build input. */
export function gridSupplyBuildInputFromSnapshot(snapshot: PlannerInputSnapshot): GridSupplyBuildInput {
	const now = new Date(snapshot.capturedAt);
	const dynamicSlots: GridSupplyBuildInput["dynamicSlots"] = [];
	for (const slot of snapshot.prices.slots15Min) {
		const slotStartMs = Date.parse(slot.slotStartIso);
		if (!Number.isFinite(slotStartMs)) continue;
		dynamicSlots.push({
			slotStartMs,
			priceCtPerKwh: slot.priceCtPerKwh ?? -1,
		});
	}

	return {
		now,
		globalMode: snapshot.general.globalMode,
		policyGridImportAllowed: snapshot.policy.gridImportAllowed,
		configuredMaxGridImportW: snapshot.policy.maxGridImportW,
		configuredHouseFuseLimitW: snapshot.policy.houseFuseLimitW,
		currentPriceCtPerKwh: snapshot.live.currentPriceCtPerKwh,
		fixedPriceCtPerKwh: snapshot.live.fixedPriceCtPerKwh,
		dynamicSlots,
	};
}

/**
 * First deterministic worker preparation stage: grid supply forecast.
 * Mirrors collectGridSupplyBuildInput → buildGridSupplyForecast from runGridSupplyTick.
 */
export function preparePlannerFromSnapshot(snapshot: PlannerInputSnapshot): PlannerPreparedInput {
	const gridInput = gridSupplyBuildInputFromSnapshot(snapshot);
	const gridForecast = buildGridSupplyForecast(gridInput);

	const constraintInput = {
		globalMode: snapshot.general.globalMode,
		configuredHouseFuseLimitW: gridForecast.configuredHouseFuseLimitW,
		configuredMaxGridImportW: gridForecast.configuredMaxGridImportW,
		effectiveMaxGridImportW: gridForecast.effectiveMaxGridImportW,
		gridImportAllowed: gridForecast.gridImportAllowed,
		gridSupplyQuality: gridForecast.quality,
	};

	const slots: PlannerPreparedSlot[] = gridForecast.slots.map((s) => ({
		startIso: s.startIso,
		endIso: s.endIso,
		priceCtPerKwh: s.priceCtPerKwh,
		importAllowed: s.importAllowed,
		maxImportPowerW: s.maxImportPowerW,
		priceLabel: s.priceLabel,
	}));

	const horizonStart = slots.length > 0 ? slots[0].startIso : snapshot.capturedAt;
	const horizonEnd =
		slots.length > 0 ? slots[slots.length - 1].endIso : snapshot.capturedAt;

	const withoutRevision: Omit<PlannerPreparedInput, "preparationRevision" | "generatedAt"> = {
		schemaVersion: 1,
		inputRevision: snapshot.inputRevision,
		timezone: snapshot.timezone,
		capturedAt: snapshot.capturedAt,
		horizonStart,
		horizonEnd,
		slots,
		policy: {
			globalMode: snapshot.general.globalMode,
			gridImportAllowed: gridForecast.gridImportAllowed,
			effectiveMaxGridImportW: gridForecast.effectiveMaxGridImportW,
			configuredMaxGridImportW: gridForecast.configuredMaxGridImportW,
			configuredHouseFuseLimitW: gridForecast.configuredHouseFuseLimitW,
			currentPriceCtPerKwh: gridForecast.currentPriceCtPerKwh,
			priceSource: gridForecast.source,
		},
		diagnostics: {
			slotCount: slots.length,
			gridSupplyQuality: gridForecast.quality.status,
			gridSupplyReasonDe: gridForecast.reasonDe,
			houseFuseConstraintStatus: houseFuseConstraintStatus(constraintInput),
			globalConstraintsStatus: globalConstraintsStatus(constraintInput),
		},
	};

	const draft: PlannerPreparedInput = {
		...withoutRevision,
		generatedAt: snapshot.capturedAt,
		preparationRevision: "",
	};
	const preparationRevision = computePreparationRevision(draft);
	return { ...draft, preparationRevision };
}
