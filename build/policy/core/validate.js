"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.failClosedCapabilities = exports.validatePolicySnapshot = void 0;
const constants_1 = require("./constants");
const normalize_1 = require("./normalize");
const value_1 = require("./value");
const VALID_SOURCES = [
    "default",
    "admin",
    "mapping",
    "learning",
    "global_mode",
    "protection",
];
const VALID_STRENGTHS = ["hard", "soft", "advisory"];
function issue(code, severity, message, path) {
    return { code, severity, message, ...(path ? { path } : {}) };
}
function validatePolicyValue(path, pv) {
    const issues = [];
    if (!VALID_SOURCES.includes(pv.source)) {
        issues.push(issue("invalid_source", "error", `Ungültige PolicySource: ${pv.source}`, path));
    }
    if (!VALID_STRENGTHS.includes(pv.strength)) {
        issues.push(issue("invalid_strength", "error", `Ungültige PolicyStrength: ${pv.strength}`, path));
    }
    if (pv.confidence !== undefined && !(0, value_1.isValidConfidence)(pv.confidence)) {
        issues.push(issue("invalid_confidence", "error", `Confidence außerhalb 0..1: ${pv.confidence}`, path));
    }
    if (typeof pv.value === "number") {
        if (!Number.isFinite(pv.value)) {
            issues.push(issue("non_finite_number", "error", "Nicht-endliche Zahl", path));
        }
    }
    return issues;
}
function validateMutualExclusions(rules) {
    const issues = [];
    const ids = new Set();
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
function validateMinMaxPair(minPath, maxPath, minVal, maxVal) {
    if (typeof minVal === "number" &&
        typeof maxVal === "number" &&
        Number.isFinite(minVal) &&
        Number.isFinite(maxVal) &&
        minVal > maxVal) {
        return [
            issue("min_greater_than_max", "error", `Minimum (${minVal}) größer als Maximum (${maxVal})`, `${minPath}/${maxPath}`),
        ];
    }
    return [];
}
function validateNegativePower(path, value) {
    if (typeof value === "number" && Number.isFinite(value) && value < 0) {
        return [issue("negative_power_limit", "error", "Negative Leistungsgrenze unzulässig", path)];
    }
    return [];
}
function validatePolicySnapshot(snapshot, opts) {
    const issues = [];
    if (!snapshot.meta?.schemaVersion) {
        issues.push(issue("missing_schema_version", "error", "Schema-Version fehlt", "meta.schemaVersion"));
    }
    else if (snapshot.meta.schemaVersion !== constants_1.POLICY_SCHEMA_VERSION) {
        issues.push(issue("schema_version_mismatch", "warning", `Schema-Version ${snapshot.meta.schemaVersion} ≠ ${constants_1.POLICY_SCHEMA_VERSION}`, "meta.schemaVersion"));
    }
    const walk = (sectionName, section) => {
        for (const key of Object.keys(section)) {
            issues.push(...validatePolicyValue(`${sectionName}.${key}`, section[key]));
        }
    };
    walk("capabilities", snapshot.capabilities);
    walk("limits", snapshot.limits);
    walk("preferences", snapshot.preferences);
    walk("protection", snapshot.protection);
    walk("economics", snapshot.economics);
    const fuse = snapshot.limits.houseFuseLimitW;
    const gridMax = snapshot.limits.maxGridImportW;
    if (fuse) {
        issues.push(...validateNegativePower("limits.houseFuseLimitW", fuse.value));
    }
    if (gridMax) {
        issues.push(...validateNegativePower("limits.maxGridImportW", gridMax.value));
    }
    const minSoc = snapshot.limits.minSocPct;
    const maxSoc = snapshot.limits.maxSocPct;
    if (minSoc || maxSoc) {
        issues.push(...validateMinMaxPair("limits.minSocPct", "limits.maxSocPct", typeof minSoc?.value === "number" ? minSoc.value : null, typeof maxSoc?.value === "number" ? maxSoc.value : null));
    }
    const mutual = snapshot.protection.mutualExclusions?.value;
    if (Array.isArray(mutual)) {
        issues.push(...validateMutualExclusions(mutual));
    }
    const sorted = (0, normalize_1.sortIssuesDeterministic)(issues);
    const hasError = sorted.some((i) => i.severity === "error");
    const hasSecurityError = sorted.some((i) => i.severity === "error" &&
        (i.code.includes("protection") ||
            i.code === "min_greater_than_max" ||
            i.code === "negative_power_limit" ||
            i.code === "mutual_exclusion"));
    let valid = !hasError;
    let status = valid ? "valid" : "invalid";
    if (opts?.failClosedOnSecurity !== false && hasSecurityError) {
        valid = false;
        status = "invalid";
    }
    else if (!valid && sorted.some((i) => i.severity === "warning")) {
        status = "degraded";
    }
    return { valid, status, issues: sorted };
}
exports.validatePolicySnapshot = validatePolicySnapshot;
function failClosedCapabilities() {
    return {
        flexibleOptimization: {
            value: "unknown",
            source: "protection",
            strength: "hard",
            valid: false,
        },
    };
}
exports.failClosedCapabilities = failClosedCapabilities;
