import type { FieldCandidate, IntentField, IntentFieldStatus } from "./types";
import { candidateUsable } from "./validation";

/**
 * Löst ein Feld aus Kandidaten nach Priorität (niedrigere Zahl = höhere Priorität).
 * Innerhalb derselben Priorität gewinnt der neuere changed_at/observed_at.
 */
export function resolveFieldFromCandidates<T>(
	candidates: FieldCandidate<T>[],
	now: Date,
): { field: IntentField<T>; conflict: boolean } {
	const usable = candidates.filter((c) => candidateUsable(c.status, c.valid_until, now));
	if (usable.length === 0) {
		const missing = candidates.find((c) => c.status === "missing");
		if (missing) {
			return {
				field: candidateToField(missing),
				conflict: false,
			};
		}
		const bestInvalid = candidates[0];
		if (bestInvalid) {
			return { field: candidateToField(bestInvalid), conflict: false };
		}
		return {
			field: emptyField<T>(now),
			conflict: false,
		};
	}

	const byPriority = new Map<number, FieldCandidate<T>[]>();
	for (const c of usable) {
		const list = byPriority.get(c.priority) ?? [];
		list.push(c);
		byPriority.set(c.priority, list);
	}

	const priorities = [...byPriority.keys()].sort((a, b) => a - b);
	for (const p of priorities) {
		const group = byPriority.get(p)!;
		if (group.length === 1) {
			return { field: candidateToField(group[0]!), conflict: false };
		}
		const sorted = [...group].sort((a, b) => timeMs(b) - timeMs(a));
		const top = sorted[0]!;
		const second = sorted[1];
		if (second && timeMs(top) === timeMs(second)) {
			return { field: candidateToField(top), conflict: true };
		}
		return { field: candidateToField(top), conflict: false };
	}

	return { field: emptyField<T>(now), conflict: false };
}

function timeMs(c: FieldCandidate<unknown>): number {
	const raw = c.changed_at ?? c.observed_at;
	const t = Date.parse(raw);
	return Number.isFinite(t) ? t : 0;
}

function candidateToField<T>(c: FieldCandidate<T>): IntentField<T> {
	return {
		value: c.value,
		status: c.status,
		origin: c.origin,
		observed_at: c.observed_at,
		changed_at: c.changed_at,
		valid_until: c.valid_until,
		raw_value: c.raw_value,
	};
}

function emptyField<T>(now: Date): IntentField<T> {
	const iso = now.toISOString();
	return {
		value: null,
		status: "missing",
		origin: {
			source: "unknown",
			owner: "unknown",
			change_kind: "unknown",
		},
		observed_at: iso,
	};
}

export function scopeIncludes(scope: string[], field: "charge_strategy" | "target_soc_pct" | "deadline"): boolean {
	return scope.includes("all") || scope.includes(field);
}
