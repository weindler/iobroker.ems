import { LEARNING_HARD_LIMIT_MIN_CONFIDENCE } from "./constants";
import { policyValue } from "./value";
import type { PolicySection, PolicySource, PolicyStrength, PolicyValue } from "./types";

export type MergeFieldKind = "minimum" | "maximum" | "hard_boolean" | "soft" | "protection" | "preference";

export interface MergeContext {
	section: PolicySection;
	field: string;
	kind: MergeFieldKind;
}

function pickSource(a: PolicySource, b: PolicySource): PolicySource {
	if (a === "protection" || b === "protection") {
		return "protection";
	}
	if (a === "global_mode" || b === "global_mode") {
		return "global_mode";
	}
	if (a === "learning" || b === "learning") {
		return "learning";
	}
	if (a === "admin" || b === "admin") {
		return "admin";
	}
	return a;
}

function mergeConfidence(a?: number, b?: number): number | undefined {
	if (a === undefined && b === undefined) {
		return undefined;
	}
	if (a === undefined) {
		return b;
	}
	if (b === undefined) {
		return a;
	}
	return Math.min(a, b);
}

function learningMayApplyHard(overlay: PolicyValue<unknown>): boolean {
	if (overlay.source !== "learning") {
		return true;
	}
	const c = overlay.confidence;
	return c !== undefined && c >= LEARNING_HARD_LIMIT_MIN_CONFIDENCE;
}

function effectiveStrength(overlay: PolicyValue<unknown>, kind: MergeFieldKind): PolicyStrength {
	if (overlay.source === "learning" && overlay.strength === "hard" && !learningMayApplyHard(overlay)) {
		return "advisory";
	}
	if (kind === "protection") {
		return "hard";
	}
	return overlay.strength;
}

export function mergePolicyValues<T>(
	base: PolicyValue<T> | undefined,
	overlay: PolicyValue<T> | undefined,
	ctx: MergeContext,
): PolicyValue<T> {
	if (!base && !overlay) {
		return policyValue<T>(null, "default", "advisory", { valid: true });
	}
	if (!base) {
		return { ...overlay! };
	}
	if (!overlay || !overlay.valid) {
		return { ...base };
	}

	const kind = ctx.kind;
	const overlayStrength = effectiveStrength(overlay as PolicyValue<unknown>, kind);

	if (kind === "preference" || kind === "soft") {
		if (overlay.source === "global_mode" && overlay.valid) {
			return { ...overlay };
		}
		if (overlayStrength === "soft" || overlayStrength === "advisory") {
			return overlay.value !== null && overlay.value !== undefined ? { ...overlay } : { ...base };
		}
	}

	if (kind === "minimum" && typeof base.value === "number" && typeof overlay.value === "number") {
		if (!learningMayApplyHard(overlay as PolicyValue<unknown>) && overlay.source === "learning") {
			return { ...base };
		}
		const value = Math.max(base.value, overlay.value) as T;
		return {
			value,
			source: pickSource(base.source, overlay.source),
			strength: "hard",
			valid: base.valid && overlay.valid,
			confidence: mergeConfidence(base.confidence, overlay.confidence),
			reason: value === overlay.value ? overlay.reason : base.reason,
		};
	}

	if (kind === "maximum" && typeof base.value === "number" && typeof overlay.value === "number") {
		if (!learningMayApplyHard(overlay as PolicyValue<unknown>) && overlay.source === "learning") {
			return { ...base };
		}
		const value = Math.min(base.value, overlay.value) as T;
		return {
			value,
			source: pickSource(base.source, overlay.source),
			strength: "hard",
			valid: base.valid && overlay.valid,
			confidence: mergeConfidence(base.confidence, overlay.confidence),
			reason: value === overlay.value ? overlay.reason : base.reason,
		};
	}

	if (kind === "hard_boolean" || kind === "protection") {
		const bVal = base.value;
		const oVal = overlay.value;
		if (bVal === false || oVal === false) {
			return policyValue(false as T, pickSource(base.source, overlay.source), "hard", {
				reason: "Restriktivere harte Regel dominiert.",
				confidence: mergeConfidence(base.confidence, overlay.confidence),
			});
		}
		if (bVal === true && oVal === true) {
			return policyValue(true as T, pickSource(base.source, overlay.source), "hard", {
				confidence: mergeConfidence(base.confidence, overlay.confidence),
			});
		}
		if (bVal === true || oVal === true) {
			const known = bVal === true ? base : overlay;
			return { ...known };
		}
		return { ...base };
	}

	if (overlayStrength === "hard" && overlay.value !== null && overlay.value !== undefined) {
		if (!learningMayApplyHard(overlay as PolicyValue<unknown>)) {
			return { ...base };
		}
		return { ...overlay };
	}

	return overlay.value !== null && overlay.value !== undefined ? { ...overlay } : { ...base };
}

export function mergePolicySections<T extends Record<string, PolicyValue<unknown>>>(
	base: T,
	overlay: T,
	section: PolicySection,
	fieldKinds: Partial<Record<string, MergeFieldKind>>,
): T {
	const keys = [...new Set([...Object.keys(base), ...Object.keys(overlay)])].sort();
	const out = {} as T;
	for (const field of keys) {
		const kind = fieldKinds[field] ?? (section === "protection" ? "protection" : "soft");
		const merged = mergePolicyValues(base[field], overlay[field], { section, field, kind });
		(out as Record<string, PolicyValue<unknown>>)[field] = merged;
	}
	return out;
}
