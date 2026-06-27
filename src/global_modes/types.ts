import type { PolicyIssue } from "../policy/core/types";
import type { GlobalMode } from "./constants";

export interface GlobalModeProfile {
	mode: GlobalMode;
	/** Flexible Optimierung erlaubt (Preference, keine Aktion). */
	flexibleOptimization: boolean;
	/** Gewichtung Wirtschaftlichkeit 0..1 */
	economyWeight: number;
	/** Gewichtung Komfort 0..1 */
	comfortWeight: number;
	/** Zulässige Verschiebung 0..1 (höher = mehr Verschiebung) */
	shiftTolerance: number;
	/** Netzbezug-Faktor: 1 = neutral, <1 restriktiver */
	gridImportFactor: number;
	/** Benutzeranforderungen priorisieren (forced) */
	userDemandPriority: boolean;
}

export type { GlobalMode } from "./constants";

export interface GlobalModeResolution {
	requested: GlobalMode;
	active: GlobalMode;
	valid: boolean;
	status: "ready" | "fallback" | "invalid";
	issues: PolicyIssue[];
	profile: GlobalModeProfile;
	revision: string;
}
