/**
 * Domain-Validity-Maske: 2 Bit je Domäne.
 * 0 = ok, 1 = partial, 2 = missing, 3 = n/a
 */

export const TELEMETRY_DOMAIN = {
	PV: 0,
	HOUSE: 1,
	GRID: 2,
	BATTERY: 3,
	PRICE: 4,
	EV: 5,
	THERMAL: 6,
	CLIMATE: 7,
	MEASURED_CONSUMERS: 8,
	PLANNER: 9,
} as const;

export type TelemetryDomain = (typeof TELEMETRY_DOMAIN)[keyof typeof TELEMETRY_DOMAIN];

export type DomainQuality = 0 | 1 | 2 | 3;

export const DOMAIN_QUALITY = {
	ok: 0 as DomainQuality,
	partial: 1 as DomainQuality,
	missing: 2 as DomainQuality,
	na: 3 as DomainQuality,
};

export const TELEMETRY_DOMAIN_COUNT = 10;

export function encodeDomainQuality(mask: number, domain: TelemetryDomain, quality: DomainQuality): number {
	const shift = domain * 2;
	const cleared = mask & ~(0b11 << shift);
	return cleared | ((quality & 0b11) << shift);
}

export function decodeDomainQuality(mask: number, domain: TelemetryDomain): DomainQuality {
	const shift = domain * 2;
	return ((mask >> shift) & 0b11) as DomainQuality;
}

/** Setzt mehrere Domänen in einer Maske. */
export function encodeQualityMask(parts: Partial<Record<keyof typeof TELEMETRY_DOMAIN, DomainQuality>>): number {
	let mask = 0;
	for (const [key, q] of Object.entries(parts)) {
		const domain = TELEMETRY_DOMAIN[key as keyof typeof TELEMETRY_DOMAIN];
		if (domain === undefined || q === undefined) continue;
		mask = encodeDomainQuality(mask, domain, q);
	}
	return mask;
}

export function worstDomainQuality(mask: number): DomainQuality {
	let worst: DomainQuality = DOMAIN_QUALITY.ok;
	for (let d = 0; d < TELEMETRY_DOMAIN_COUNT; d++) {
		const q = decodeDomainQuality(mask, d as TelemetryDomain);
		if (q === DOMAIN_QUALITY.na) continue;
		if (q > worst) worst = q;
	}
	return worst;
}
