/**
 * Reine Umverteilungs-Mathematik für den Plan-Vergleich (Block "Plan B").
 *
 * Idee: dieselbe Energiemenge, die Plan A einem Add-on (Heizstab-flexibel oder Klima) über den
 * Tag zugeteilt hat, wird — gewichtet nach KI-Zeitpunkt-Präferenzen — über die Slots neu verteilt,
 * begrenzt durch das, was in jedem Slot (nach Plan A) an PV-Überschuss/Netz-Freiraum ohnehin schon
 * verfügbar war. Ohne KI-Gewichtung (multiplier=1 überall) reproduziert das Ergebnis exakt Plan A.
 */

export interface SlotCapacity {
	/** Von Plan A in diesem Slot bereits zugeteilte Leistung dieses Add-ons (W). */
	ownW: number;
	/** Maximal denkbare Leistung dieses Add-ons in diesem Slot, ohne andere Plan-A-Zusagen zu verletzen (W). */
	capacityW: number;
}

const SLOT_WEIGHT_MULTIPLIER_MIN = 0;
const SLOT_WEIGHT_MULTIPLIER_MAX = 3;

/**
 * Gewicht eines Slots für die Umverteilung. multiplier=1 → Gewicht=ownW (Identität mit Plan A).
 * multiplier=0 → Gewicht 0 (Slot wird komplett gemieden). multiplier>1 → zusätzlicher Zugriff auf
 * bisher ungenutzten Kapazitäts-Freiraum (capacityW - ownW), proportional zur Übersteuerung.
 */
export function computeSlotWeight(ownW: number, capacityW: number, multiplier: number): number {
	const m = Math.max(SLOT_WEIGHT_MULTIPLIER_MIN, Math.min(SLOT_WEIGHT_MULTIPLIER_MAX, multiplier));
	const safeOwnW = Math.max(0, ownW);
	const extra = Math.max(0, capacityW - safeOwnW);
	return safeOwnW * m + extra * Math.max(0, m - 1);
}

/**
 * Verteilt `total` proportional zu `weights` über alle Slots, begrenzt durch `capacities`.
 * Klassisches "Water-Filling": Slots, deren proportionaler Anteil ihre Kapazität übersteigen würde,
 * werden auf ihre Kapazität gedeckelt und aus der weiteren Verteilung entfernt; der Rest wird unter
 * den verbleibenden Slots erneut proportional verteilt — bis alles platziert ist oder keine Kapazität
 * mehr frei ist. Erhält die Gesamtenergie exakt (sofern genug Gesamtkapazität vorhanden ist).
 *
 * Falls positiv gewichtete Slots erschöpft sind, bleibt Restenergie unverteilt — Slots mit
 * Gewicht 0 (explizit gemieden, z. B. defer_tomorrow heute) bekommen keinen Fallback.
 * Neutral/positiv gewichtete Slots dürfen den Rest weiterhin aufnehmen.
 */
export function waterFillProportional(weights: number[], capacities: number[], total: number): number[] {
	const n = weights.length;
	const allocated = new Array(n).fill(0);
	if (n === 0 || !(total > 0)) return allocated;

	const totalCapacity = capacities.reduce((sum, c) => sum + Math.max(0, c), 0);
	let remainingTotal = Math.min(total, totalCapacity);

	const fillRound = (candidateWeights: number[]): void => {
		let active = candidateWeights
			.map((w, i) => i)
			.filter((i) => candidateWeights[i] > 0 && capacities[i] - allocated[i] > 1e-9);

		let guard = 0;
		while (active.length > 0 && remainingTotal > 1e-6 && guard <= n + 1) {
			guard += 1;
			const weightSum = active.reduce((sum, i) => sum + candidateWeights[i], 0);
			if (!(weightSum > 0)) break;

			const clampedThisRound: number[] = [];
			for (const i of active) {
				const share = (candidateWeights[i] / weightSum) * remainingTotal;
				const room = capacities[i] - allocated[i];
				if (share >= room - 1e-9) {
					clampedThisRound.push(i);
				}
			}

			if (clampedThisRound.length === 0) {
				for (const i of active) {
					allocated[i] += (candidateWeights[i] / weightSum) * remainingTotal;
				}
				remainingTotal = 0;
				break;
			}

			for (const i of clampedThisRound) {
				const room = capacities[i] - allocated[i];
				allocated[i] += room;
				remainingTotal -= room;
			}
			active = active.filter((i) => !clampedThisRound.includes(i));
		}
	};

	fillRound(weights);
	if (remainingTotal > 1e-6) {
		// Nur Slots mit positiver Präferenz: Gewicht 0 ist harter Ausschluss.
		// Restenergie bleibt unverteilt (deferred) — nicht zurück auf gemiedene Slots.
		const fallbackWeights = capacities.map((c, i) =>
			(weights[i] ?? 0) > 0 ? Math.max(0, c - allocated[i]) : 0,
		);
		fillRound(fallbackWeights);
	}

	return allocated;
}

/**
 * Verwirft Leistungen unter minPowerW und bündelt die Energie in fahrbare Slots
 * (ganze minPowerW-Quanten), kapazitätsbegrenzt. Rest unter einer Stufe bleibt 0.
 */
export function coalescePowersToMinStage(powers: number[], capacities: number[], minPowerW: number): number[] {
	const n = powers.length;
	const out = new Array(n).fill(0);
	if (!(minPowerW > 0) || n === 0) return powers.map((p) => Math.max(0, p));

	let pool = 0;
	for (let i = 0; i < n; i++) {
		const p = Math.max(0, powers[i] ?? 0);
		if (p >= minPowerW) {
			out[i] = p;
		} else {
			pool += p;
		}
	}

	const order = powers
		.map((p, i) => i)
		.sort((a, b) => (powers[b] ?? 0) - (powers[a] ?? 0) || a - b);

	for (const i of order) {
		if (pool < minPowerW) break;
		const room = Math.max(0, (capacities[i] ?? 0) - out[i]);
		if (room < minPowerW) continue;
		const add = Math.min(pool, room, Math.floor(room / minPowerW) * minPowerW);
		if (add < minPowerW) continue;
		out[i] += add;
		pool -= add;
	}
	return out;
}

/**
 * Verteilt die von Plan A für ein Add-on zugeteilte flexible Energie gemäß KI-Multiplikatoren neu,
 * kapazitätsbegrenzt. Slots mit Multiplikator 0 werden nicht per Fallback wieder befüllt;
 * nicht untergebrachte Energie bleibt unverteilt (deferred).
 * Optional: `minPowerW` verhindert Mikro-Slots nach der Umverteilung.
 */
export function redistributeAddonAcrossSlots(
	slots: SlotCapacity[],
	multipliers: number[],
	minPowerW?: number | null,
): number[] {
	const weights = slots.map((s, i) => computeSlotWeight(s.ownW, s.capacityW, multipliers[i] ?? 1));
	const capacities = slots.map((s) => Math.max(0, s.capacityW));
	const total = slots.reduce((sum, s) => sum + Math.max(0, s.ownW), 0);
	const raw = waterFillProportional(weights, capacities, total);
	if (minPowerW !== null && minPowerW !== undefined && minPowerW > 0) {
		return coalescePowersToMinStage(raw, capacities, minPowerW);
	}
	return raw;
}
