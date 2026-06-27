import {
	LEARNING_HARD_LIMIT_MIN_CONFIDENCE,
	POLICY_SCHEMA_VERSION,
} from "./constants";
import { sortIssuesDeterministic } from "./normalize";
import { isValidConfidence } from "./value";
import type {
	MutualExclusionRule,
	PolicyIssue,
	PolicySnapshot,
	PolicySource,
	PolicyStrength,
	PolicyValidationResult,
	TriState,
} from "./types";

const VALID_SOURCES: PolicySource[] = [
	"default",
	"admin",
	"mapping",
	"learning",
	"global_mode",
	"protection",
];

const VALID_STRENGTHS: PolicyStrength[] = ["hard", "soft", "advisory"];

function issue(
	code: string,
	severity: PolicyIssue["severity"],
	message: string,
	path?: string,
): PolicyIssue {
	return { code, severity, message, ...(path ? { path } : {}) };
}

function validatePolicyValue(path: string, pv: { value: unknown; source: PolicySource; strength: PolicyStrength; valid: boolean; confidence?: number }): PolicyIssue[] {
	const issues: PolicyIssue[] = [];
	if (!VALID_SOURCES.includes(pv.source)) {
		issues.push(issue("invalid_source", "error", `Ungültige PolicySource: ${pv.source}`, path));
	}
	if (!VALID_STRENGTHS.includes(pv.strength)) {
		issues.push(issue("invalid_strength", "error", `Ungültige PolicyStrength: ${pv.strength}`, path));
	}
	if (pv.confidence !== undefined && !isValidConfidence(pv.confidence)) {
		issues.push(issue("invalid_confidence", "error", `Confidence außerhalb 0..1: ${pv.confidence}`, path));
	}
	if (typeof pv.value === "number") {
		if (!Number.isFinite(pv.value)) {
			issues.push(issue("non_finite_number", "error", "Nicht-endliche Zahl", path));
		}
	}
	return issues;
}

function validateMutualExclusions(rules: MutualExclusionRule[]): PolicyIssue[] {
	const issues: PolicyIssue[] = [];
	const ids = new Set<string>();
	for (const r of rules) {
		if (!r.id?.trim()) {
			issues.push(issue("mutual_exclusion_empty_id", "error", "Mutual-Exclusion ohne ID"));
			continue;
		}
		if (ids.has(r.id)) {
			issues.push(issue("mutual_exclusion_duplicate_id", "error", `Doppelte Mutual-Exclusion-ID: ${r.id}`));
		}
		ids.add(r.id);
		if (!r.addonA?.trim() || !r.addonB?.trim()) {
			issues.push(issue("mutual_exclusion_invalid_addon", "error", `Ungültige Add-ons in ${r.id}`));
		}
		if (r.addonA === r.addonB) {
			issues.push(issue("mutual_exclusion_same_addon", "error", `Add-on darf nicht sich selbst ausschließen: ${r.id}`));
		}
	}
	return issues;
}

function validateMinMaxPair(
	minPath: string,
	maxPath: string,
	minVal: number | null | undefined,
	maxVal: number | null | undefined,
): PolicyIssue[] {
	if (
		typeof minVal === "number" &&
		typeof maxVal === "number" &&
		Number.isFinite(minVal) &&
		Number.isFinite(maxVal) &&
		minVal > maxVal
	) {
		return [
			issue(
				"min_greater_than_max",
				"error",
				`Minimum (${minVal}) größer als Maximum (${maxVal})`,
				`${minPath}/${maxPath}`,
			),
		];
	}
	return [];
}

function validateNegativePower(path: string, value: unknown): PolicyIssue[] {
	if (typeof value === "number" && Number.isFinite(value) && value < 0) {
		return [issue("negative_power_limit", "error", "Negative Leistungsgrenze unzulässig", path)];
	}
	return [];
}

export interface ValidatePolicyOptions {
	/** Fail closed bei sicherheitsrelevanten Fehlern */
	failClosedOnSecurity?: boolean;
}

export function validatePolicySnapshot(
	snapshot: PolicySnapshot,
	opts?: ValidatePolicyOptions,
): PolicyValidationResult {
	const issues: PolicyIssue[] = [];

	if (!snapshot.meta?.schemaVersion) {
		issues.push(issue("missing_schema_version", "error", "Schema-Version fehlt", "meta.schemaVersion"));
	} else if (snapshot.meta.schemaVersion !== POLICY_SCHEMA_VERSION) {
		issues.push(
			issue(
				"schema_version_mismatch",
				"warning",
				`Schema-Version ${snapshot.meta.schemaVersion} ≠ ${POLICY_SCHEMA_VERSION}`,
				"meta.schemaVersion",
			),
		);
	}

	const walk = (sectionName: string, section: Record<string, { value: unknown; source: PolicySource; strength: PolicyStrength; valid: boolean; confidence?: number }>) => {
		for (const key of Object.keys(section)) {
			issues.push(...validatePolicyValue(`${sectionName}.${key}`, section[key]));
		}
	};

	walk("capabilities", snapshot.capabilities as Record<string, { value: unknown; source: PolicySource; strength: PolicyStrength; valid: boolean; confidence?: number }>);
	walk("limits", snapshot.limits as Record<string, { value: unknown; source: PolicySource; strength: PolicyStrength; valid: boolean; confidence?: number }>);
	walk("preferences", snapshot.preferences as Record<string, { value: unknown; source: PolicySource; strength: PolicyStrength; valid: boolean; confidence?: number }>);
	walk("protection", snapshot.protection as Record<string, { value: unknown; source: PolicySource; strength: PolicyStrength; valid: boolean; confidence?: number }>);
	walk("economics", snapshot.economics as Record<string, { value: unknown; source: PolicySource; strength: PolicyStrength; valid: boolean; confidence?: number }>);

	const fuse = snapshot.limits.houseFuseLimitW;
	const gridMax = snapshot.limits.maxGridImportW;
	if (fuse) {
		issues.push(...validateNegativePower("limits.houseFuseLimitW", fuse.value));
	}
	if (gridMax) {
		issues.push(...validateNegativePower("limits.maxGridImportW", gridMax.value));
	}

	const minSoc = snapshot.limits.minSocPct as { value: unknown } | undefined;
	const maxSoc = snapshot.limits.maxSocPct as { value: unknown } | undefined;
	if (minSoc || maxSoc) {
		issues.push(
			...validateMinMaxPair(
				"limits.minSocPct",
				"limits.maxSocPct",
				typeof minSoc?.value === "number" ? minSoc.value : null,
				typeof maxSoc?.value === "number" ? maxSoc.value : null,
			),
		);
	}

	const mutual = snapshot.protection.mutualExclusions?.value;
	if (Array.isArray(mutual)) {
		issues.push(...validateMutualExclusions(mutual as MutualExclusionRule[]));
	}

	const sorted = sortIssuesDeterministic(issues);
	const hasError = sorted.some((i) => i.severity === "error");
	const hasSecurityError = sorted.some(
		(i) =>
			i.severity === "error" &&
			(i.code.includes("protection") ||
				i.code === "min_greater_than_max" ||
				i.code === "negative_power_limit" ||
				i.code === "mutual_exclusion"),
	);

	let valid = !hasError;
	let status: PolicyValidationResult["status"] = valid ? "valid" : "invalid";

	if (opts?.failClosedOnSecurity !== false && hasSecurityError) {
		valid = false;
		status = "invalid";
	} else if (!valid && sorted.some((i) => i.severity === "warning")) {
		status = "degraded";
	}

	return { valid, status, issues: sorted };
}

export function failClosedCapabilities(): Record<string, { value: TriState; source: PolicySource; strength: PolicyStrength; valid: boolean }> {
	return {
		flexibleOptimization: {
			value: "unknown",
			source: "protection",
			strength: "hard",
			valid: false,
		},
	};
}
