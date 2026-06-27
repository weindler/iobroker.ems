import { CONFIDENCE_MAX, CONFIDENCE_MIN } from "./constants";
import type { PolicySource, PolicyStrength, PolicyValue, TriState } from "./types";

export function clampConfidence(raw: number | undefined): number | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (!Number.isFinite(raw)) {
		return undefined;
	}
	return Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, raw));
}

export function isValidConfidence(raw: unknown): raw is number {
	return typeof raw === "number" && Number.isFinite(raw) && raw >= CONFIDENCE_MIN && raw <= CONFIDENCE_MAX;
}

export function policyValue<T>(
	value: T | null,
	source: PolicySource,
	strength: PolicyStrength,
	opts?: { confidence?: number; reason?: string; sourcePath?: string; valid?: boolean },
): PolicyValue<T> {
	const confidence = clampConfidence(opts?.confidence);
	return {
		value,
		source,
		strength,
		valid: opts?.valid ?? true,
		...(confidence !== undefined ? { confidence } : {}),
		...(opts?.reason ? { reason: opts.reason } : {}),
		...(opts?.sourcePath ? { sourcePath: opts.sourcePath } : {}),
	};
}

export function unknownTriState(
	source: PolicySource = "default",
	strength: PolicyStrength = "advisory",
): PolicyValue<TriState> {
	return policyValue<TriState>("unknown", source, strength, {
		reason: "Wert unbekannt — kein Fallback.",
	});
}

export function unknownValue<T>(
	source: PolicySource = "default",
	strength: PolicyStrength = "advisory",
): PolicyValue<T> {
	return policyValue<T>(null, source, strength, {
		reason: "Wert unbekannt — kein Fallback.",
	});
}

export function isUnknownTriState(v: PolicyValue<TriState>): boolean {
	return v.value === "unknown" || v.value === null;
}

export function isKnownNumber(v: PolicyValue<unknown>): v is PolicyValue<number> & { value: number } {
	return typeof v.value === "number" && Number.isFinite(v.value) && v.valid;
}
