import type { GridDataStatus, GridSupplyForecast } from "../grid_supply/types";

export interface ConstraintDiagnosticInput {
	globalMode: string | null;
	configuredHouseFuseLimitW: number | null;
	configuredMaxGridImportW: number | null;
	effectiveMaxGridImportW: number | null;
	gridImportAllowed: boolean;
	gridSupplyQuality: GridSupplyForecast["quality"];
}

/** Pure diagnostic status derived from snapshot policy fields — no operator contributions. */
export function houseFuseConstraintStatus(input: ConstraintDiagnosticInput): GridDataStatus {
	const hasLimits =
		input.configuredHouseFuseLimitW !== null || input.configuredMaxGridImportW !== null;
	return hasLimits ? "valid" : "missing";
}

export function globalConstraintsStatus(input: ConstraintDiagnosticInput): GridDataStatus {
	const hasEffective =
		input.effectiveMaxGridImportW !== null ||
		input.gridImportAllowed !== undefined ||
		input.globalMode !== null;
	if (!hasEffective) return "missing";
	return input.gridSupplyQuality.status === "valid" ? "valid" : "degraded";
}
