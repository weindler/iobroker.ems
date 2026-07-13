import type { GridPriceLabel } from "../grid_supply/types";

export interface PlannerPreparedSlot {
	startIso: string;
	endIso: string;
	priceCtPerKwh: number | null;
	importAllowed: boolean;
	maxImportPowerW: number | null;
	priceLabel: GridPriceLabel;
}

export interface PlannerPreparedPolicy {
	globalMode: string | null;
	gridImportAllowed: boolean;
	effectiveMaxGridImportW: number | null;
	configuredMaxGridImportW: number | null;
	configuredHouseFuseLimitW: number | null;
	currentPriceCtPerKwh: number | null;
	priceSource: string;
}

export interface PlannerPreparationDiagnostics {
	slotCount: number;
	gridSupplyQuality: string;
	gridSupplyReasonDe: string;
	houseFuseConstraintStatus: string;
	globalConstraintsStatus: string;
}

/**
 * Compact, serializable output of the first worker preparation stage (grid supply).
 * Derived deterministically from PlannerInputSnapshot v2.
 */
export interface PlannerPreparedInput {
	schemaVersion: 1;
	inputRevision: string;
	preparationRevision: string;
	generatedAt: string;
	timezone: string;
	capturedAt: string;
	horizonStart: string;
	horizonEnd: string;
	slots: PlannerPreparedSlot[];
	policy: PlannerPreparedPolicy;
	diagnostics: PlannerPreparationDiagnostics;
}

export class PlannerPreparedInputBudgetError extends Error {
	constructor(
		public readonly byteSize: number,
		public readonly budgetBytes: number,
	) {
		super(`prepared input exceeds budget: ${byteSize} > ${budgetBytes} bytes`);
		this.name = "PlannerPreparedInputBudgetError";
	}
}

export class PlannerInputValidationError extends Error {
	constructor(
		public readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "PlannerInputValidationError";
	}
}
