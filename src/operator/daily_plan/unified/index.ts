/**
 * Unified Day Planner Contract (Schritt 1) — Typen, Prinzip-Bewertung, Replan-Trigger.
 * Allocation-Algorithmus = Schritt 2. Keine Live-Writes hier.
 */

export * from "./types";
export * from "./evaluate";
export {
	buildSlots,
	golden001Input,
	golden001BadPlan,
	golden001GoodPlan,
	golden001ScaledInput,
	golden001ScaledBadPlan,
	golden002Input,
	golden002BadPlanAbsentCharge,
	golden002GoodPlan,
	golden003Input,
	golden003BadEarlyGrid,
	golden003GoodPv,
	golden004Input,
	golden004ReplanPlan,
	golden004StalePlanNoReplan,
	golden005Input,
	golden005BadNightBatteryHeat,
	golden005GoodDayPvHeat,
} from "./fixtures";
