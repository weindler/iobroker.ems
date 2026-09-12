/**
 * Energetische Statistik aus der bestehenden Day-Telemetry.
 *
 * Reporting only: keine Planner- oder Gerätewirkung. Alle Ableitungen sind konservativ;
 * unvollständige Messketten ergeben `null` statt einer erfundenen Null.
 */

import { DOMAIN_QUALITY, TELEMETRY_DOMAIN, decodeDomainQuality } from "../learning/day_telemetry/quality_mask";
import type { DayTelemetryDayRecord } from "../learning/day_telemetry/types";
import type { EnergeticDayTotals, EnergeticPeriodSummary } from "./types";

function finite(value: number | null | undefined): value is number {
	return value != null && Number.isFinite(value);
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function sumKnown(values: Array<number | null> | null | undefined): number | null {
	if (!Array.isArray(values)) return null;
	let total = 0;
	let known = 0;
	for (const value of values) {
		if (!finite(value)) continue;
		total += Math.max(0, value);
		known += 1;
	}
	return known > 0 ? round3(total) : null;
}

function firstKnown(values: Array<number | null>): number | null {
	for (const value of values) if (finite(value)) return value;
	return null;
}

function lastKnown(values: Array<number | null>): number | null {
	for (let index = values.length - 1; index >= 0; index--) {
		const value = values[index];
		if (finite(value)) return value;
	}
	return null;
}

function percentage(numerator: number | null, denominator: number | null): number | null {
	if (!finite(numerator) || !finite(denominator) || denominator <= 0) return null;
	return round1(clamp01(numerator / denominator) * 100);
}

function observedSelfConsumption(day: DayTelemetryDayRecord): {
	energyKwh: number | null;
	pvBasisKwh: number | null;
} {
	let energy = 0;
	let basis = 0;
	let pairs = 0;
	for (let index = 0; index < day.slotCount; index++) {
		const pv = day.buckets.pvKwh[index];
		const exported = day.buckets.gridExportKwh[index];
		if (!finite(pv) || !finite(exported)) continue;
		basis += Math.max(0, pv);
		energy += Math.max(0, Math.min(pv, pv - Math.max(0, exported)));
		pairs += 1;
	}
	return pairs > 0
		? { energyKwh: round3(energy), pvBasisKwh: round3(basis) }
		: { energyKwh: null, pvBasisKwh: null };
}

function observedAutonomy(day: DayTelemetryDayRecord): {
	nonGridKwh: number | null;
	consumptionBasisKwh: number | null;
	gridImportBasisKwh: number | null;
} {
	let nonGrid = 0;
	let consumption = 0;
	let grid = 0;
	let pairs = 0;
	for (let index = 0; index < day.slotCount; index++) {
		const house = day.buckets.houseTotalKwh[index];
		const imported = day.buckets.gridImportKwh[index];
		if (!finite(house) || !finite(imported)) continue;
		const load = Math.max(0, house);
		const importServingLoad = Math.min(load, Math.max(0, imported));
		consumption += load;
		grid += importServingLoad;
		nonGrid += load - importServingLoad;
		pairs += 1;
	}
	return pairs > 0
		? {
			nonGridKwh: round3(nonGrid),
			consumptionBasisKwh: round3(consumption),
			gridImportBasisKwh: round3(grid),
		}
		: { nonGridKwh: null, consumptionBasisKwh: null, gridImportBasisKwh: null };
}

type PvAttribution = {
	energyKwh: number | null;
	pvKwh: number | null;
	pvSharePct: number | null;
};

type FastChargeAttribution = {
	energyKwh: number | null;
	batteryKwh: number | null;
	batterySharePct: number | null;
	gridKwh: number | null;
	gridSharePct: number | null;
	localKwh: number | null;
	localSharePct: number | null;
	modeComplete: boolean;
	sourcesComplete: boolean;
};

/**
 * Ordnet die zeitgleichen Quellen im EVCC-Schnellmodus proportional zur gesamten
 * Hauslast zu. Das ist eine explizite Bilanzierungsregel für physikalisch nicht
 * unterscheidbare Elektronen: Netzbezug und Batterieentladung werden gemessen,
 * der geschlossene Rest ist lokale Versorgung (typisch PV).
 */
export function fastChargeAttribution(day: DayTelemetryDayRecord): FastChargeAttribution {
	const fast = day.buckets.evFastChargedKwh;
	if (!Array.isArray(fast)) {
		return {
			energyKwh: null,
			batteryKwh: null,
			batterySharePct: null,
			gridKwh: null,
			gridSharePct: null,
			localKwh: null,
			localSharePct: null,
			modeComplete: false,
			sourcesComplete: false,
		};
	}
	let total = 0;
	let battery = 0;
	let grid = 0;
	let local = 0;
	let known = 0;
	let modeComplete = true;
	let sourcesComplete = true;
	for (let index = 0; index < day.slotCount; index++) {
		const ev = day.buckets.evChargedKwh[index];
		const fastKwh = fast[index];
		if (finite(ev) && ev > 0 && !finite(fastKwh)) modeComplete = false;
		if (!finite(fastKwh)) continue;
		const amount = Math.max(0, fastKwh);
		total += amount;
		known += 1;
		if (amount === 0) continue;

		const house = day.buckets.houseTotalKwh[index];
		const gridImport = day.buckets.gridImportKwh[index];
		const batteryDischarge = day.buckets.batteryDischargedKwh[index];
		if (!finite(house) || !finite(gridImport) || !finite(batteryDischarge) || house <= 0 || amount > house * 1.05) {
			sourcesComplete = false;
			continue;
		}

		let gridServingHouse = Math.max(0, gridImport);
		let batteryServingHouse = Math.max(0, batteryDischarge);
		const measuredDirect = gridServingHouse + batteryServingHouse;
		if (measuredDirect > house) {
			/* Kleine zeitliche/Messpunkt-Abweichungen proportional schließen, nie mehr als EV-Energie zuordnen. */
			const scale = house / measuredDirect;
			gridServingHouse *= scale;
			batteryServingHouse *= scale;
		}
		const ratio = clamp01(amount / house);
		const gridForEv = gridServingHouse * ratio;
		const batteryForEv = batteryServingHouse * ratio;
		const localForEv = Math.max(0, amount - gridForEv - batteryForEv);
		grid += gridForEv;
		battery += batteryForEv;
		local += localForEv;
	}
	if (known === 0 || !modeComplete) {
		return {
			energyKwh: null,
			batteryKwh: null,
			batterySharePct: null,
			gridKwh: null,
			gridSharePct: null,
			localKwh: null,
			localSharePct: null,
			modeComplete,
			sourcesComplete: false,
		};
	}
	const energyKwh = round3(total);
	const batteryKwh = sourcesComplete ? round3(Math.min(total, battery)) : null;
	const gridKwh = sourcesComplete ? round3(Math.min(total, grid)) : null;
	const localKwh = sourcesComplete ? round3(Math.min(total, local)) : null;
	return {
		energyKwh,
		batteryKwh,
		batterySharePct: total > 0 ? percentage(batteryKwh, energyKwh) : null,
		gridKwh,
		gridSharePct: total > 0 ? percentage(gridKwh, energyKwh) : null,
		localKwh,
		localSharePct: total > 0 ? percentage(localKwh, energyKwh) : null,
		modeComplete,
		sourcesComplete,
	};
}

/**
 * Ordnet die gleichzeitig vor Ort genutzte PV proportional zur gemessenen Hauslast zu.
 * Sobald für einen positiven Verbraucher-Slot eine der drei Messgrößen fehlt, bleibt dessen
 * PV-Anteil für den ganzen betrachteten Tag `null`.
 */
function attributeDevicePv(
	day: DayTelemetryDayRecord,
	device: Array<number | null> | null | undefined,
): PvAttribution {
	if (!Array.isArray(device)) return { energyKwh: null, pvKwh: null, pvSharePct: null };
	let energy = 0;
	let pvEnergy = 0;
	let known = 0;
	let attributionMissing = false;
	for (let index = 0; index < day.slotCount; index++) {
		const deviceKwh = device[index];
		if (!finite(deviceKwh)) continue;
		const load = Math.max(0, deviceKwh);
		energy += load;
		known += 1;
		if (load === 0) continue;
		const pv = day.buckets.pvKwh[index];
		const exported = day.buckets.gridExportKwh[index];
		const house = day.buckets.houseTotalKwh[index];
		if (!finite(pv) || !finite(exported) || !finite(house) || house <= 0) {
			attributionMissing = true;
			continue;
		}
		const onSitePv = Math.max(0, Math.min(pv, pv - Math.max(0, exported)));
		pvEnergy += load * clamp01(onSitePv / house);
	}
	if (known === 0) return { energyKwh: null, pvKwh: null, pvSharePct: null };
	const energyKwh = round3(energy);
	const pvKwh = attributionMissing ? null : round3(Math.min(energy, pvEnergy));
	return {
		energyKwh,
		pvKwh,
		pvSharePct: energy > 0 ? percentage(pvKwh, energyKwh) : null,
	};
}

function batteryPvAttribution(day: DayTelemetryDayRecord): PvAttribution {
	const charge = day.buckets.batteryChargedKwh;
	const source = day.buckets.batteryChargeSource;
	if (!Array.isArray(charge) || !Array.isArray(source)) {
		return { energyKwh: null, pvKwh: null, pvSharePct: null };
	}
	let total = 0;
	let pv = 0;
	let known = 0;
	let ambiguous = false;
	for (let index = 0; index < day.slotCount; index++) {
		const kwh = charge[index];
		if (!finite(kwh)) continue;
		const amount = Math.max(0, kwh);
		total += amount;
		known += 1;
		if (amount === 0) continue;
		if (source[index] === "pv") pv += amount;
		else if (source[index] !== "grid") ambiguous = true;
	}
	if (known === 0) return { energyKwh: null, pvKwh: null, pvSharePct: null };
	const energyKwh = round3(total);
	const pvKwh = ambiguous ? null : round3(pv);
	return { energyKwh, pvKwh, pvSharePct: total > 0 ? percentage(pvKwh, energyKwh) : null };
}

function batteryCapacityKwh(day: DayTelemetryDayRecord): number | null {
	const values = day.forecastSnapshots
		.map((snapshot) => snapshot.batteryCapacityKwh)
		.filter(finite);
	if (values.length === 0) return null;
	const min = Math.min(...values);
	const max = Math.max(...values);
	if (min <= 0 || max - min > Math.max(0.1, max * 0.02)) return null;
	return values[values.length - 1] ?? null;
}

function batteryDomainComplete(day: DayTelemetryDayRecord): boolean {
	const masks = day.buckets.qualityMask.filter(finite);
	if (masks.length === 0) return false;
	return masks.every(
		(mask) => decodeDomainQuality(mask, TELEMETRY_DOMAIN.BATTERY) === DOMAIN_QUALITY.ok,
	);
}

function measuredBatteryLossKwh(
	day: DayTelemetryDayRecord,
	chargedKwh: number | null,
	dischargedKwh: number | null,
): { value: number | null; reason: string | null } {
	if (!day.complete || !day.evaluable) {
		return { value: null, reason: "Batterieverlust erst für einen vollständigen, bewertbaren Tag." };
	}
	if (
		day.firstSampleMs == null ||
		day.lastSampleMs == null ||
		day.firstSampleMs > day.startMs + day.slotWidthMs * 2 ||
		day.lastSampleMs < day.endMs - day.slotWidthMs * 2 ||
		!batteryDomainComplete(day)
	) {
		return { value: null, reason: "Batterieverlust: SOC-/Leistungsabdeckung an den Tagesgrenzen unvollständig." };
	}
	const capacityKwh = batteryCapacityKwh(day);
	const startSoc = firstKnown(day.buckets.batterySocEndPct);
	const endSoc = lastKnown(day.buckets.batterySocEndPct);
	if (!finite(capacityKwh) || !finite(startSoc) || !finite(endSoc) || !finite(chargedKwh) || !finite(dischargedKwh)) {
		return { value: null, reason: "Batterieverlust: Kapazität, SOC oder Energiefluss fehlt." };
	}
	const storedDeltaKwh = ((endSoc - startSoc) / 100) * capacityKwh;
	const loss = chargedKwh - dischargedKwh - storedDeltaKwh;
	if (loss < -0.1) {
		return { value: null, reason: "Batterieverlust: Messbilanz widersprüchlich; kein Wert ausgewiesen." };
	}
	return { value: round3(Math.max(0, loss)), reason: null };
}

export function buildEnergeticDayTotals(day: DayTelemetryDayRecord): EnergeticDayTotals {
	const self = observedSelfConsumption(day);
	const autonomy = observedAutonomy(day);
	const battery = batteryPvAttribution(day);
	const batteryDischargedKwh = sumKnown(day.buckets.batteryDischargedKwh);
	const batteryLoss = measuredBatteryLossKwh(day, battery.energyKwh, batteryDischargedKwh);
	const immersion = attributeDevicePv(day, day.buckets.immersionKwh);
	const ev = attributeDevicePv(day, day.buckets.evChargedKwh);
	const evFast = fastChargeAttribution(day);
	/* Shared-Power elektrisch einmal zählen, nicht die per Unit gespiegelt comfort energy. */
	const climate = attributeDevicePv(day, day.buckets.climateElecSharedKwh);
	const gridBalanceDischargeKwh = sumKnown(day.buckets.gridBalanceDischargeKwh);
	const notesDe: string[] = [];
	if (!day.complete) notesDe.push("Laufender Tag: Werte sind eine Zwischenbilanz.");
	if (!day.evaluable) notesDe.push(`Day-Telemetry noch nicht bewertbar (${round1(day.coveragePct)} % Abdeckung).`);
	if (batteryLoss.reason) notesDe.push(batteryLoss.reason);
	if (
		(immersion.energyKwh ?? 0) > 0 && immersion.pvKwh === null ||
		(ev.energyKwh ?? 0) > 0 && ev.pvKwh === null ||
		(climate.energyKwh ?? 0) > 0 && climate.pvKwh === null
	) {
		notesDe.push("Mindestens ein Geräte-PV-Anteil ist wegen unvollständiger zeitgleicher PV-/Netz-/Hausmessung nicht bestimmbar.");
	}
	if (!evFast.modeComplete && (ev.energyKwh ?? 0) > 0) {
		notesDe.push("Schnellmodus-Anteil nicht bestimmbar: EVCC-Modus war während einer Ladung nicht vollständig verfügbar.");
	} else if ((evFast.energyKwh ?? 0) > 0 && !evFast.sourcesComplete) {
		notesDe.push("Schnellmodus-Quellen nicht bestimmbar: Hauslast, Netzbezug oder Batterieentladung war unvollständig.");
	}

	return {
		dateKey: day.dateKey,
		source: "day_telemetry",
		complete: day.complete,
		evaluable: day.evaluable,
		coveragePct: round1(day.coveragePct),
		pvGenerationKwh: sumKnown(day.buckets.pvKwh),
		houseConsumptionKwh: sumKnown(day.buckets.houseTotalKwh),
		gridImportKwh: sumKnown(day.buckets.gridImportKwh),
		gridExportKwh: sumKnown(day.buckets.gridExportKwh),
		selfConsumptionKwh: self.energyKwh,
		selfConsumptionPct: percentage(self.energyKwh, self.pvBasisKwh),
		selfConsumptionPvBasisKwh: self.pvBasisKwh,
		autonomyPct: percentage(autonomy.nonGridKwh, autonomy.consumptionBasisKwh),
		autonomyConsumptionBasisKwh: autonomy.consumptionBasisKwh,
		autonomyGridImportBasisKwh: autonomy.gridImportBasisKwh,
		batteryChargedKwh: battery.energyKwh,
		batteryDischargedKwh,
		batteryPvChargedKwh: battery.pvKwh,
		batteryPvSharePct: battery.pvSharePct,
		batteryMeasuredLossKwh: batteryLoss.value,
		immersionEnergyKwh: immersion.energyKwh,
		immersionPvKwh: immersion.pvKwh,
		immersionPvSharePct: immersion.pvSharePct,
		evChargedKwh: ev.energyKwh,
		evPvKwh: ev.pvKwh,
		evPvSharePct: ev.pvSharePct,
		evFastChargedKwh: evFast.energyKwh,
		evFastBatteryKwh: evFast.batteryKwh,
		evFastBatterySharePct: evFast.batterySharePct,
		evFastGridKwh: evFast.gridKwh,
		evFastGridSharePct: evFast.gridSharePct,
		evFastLocalKwh: evFast.localKwh,
		evFastLocalSharePct: evFast.localSharePct,
		climateEnergyKwh: climate.energyKwh,
		climatePvKwh: climate.pvKwh,
		climatePvSharePct: climate.pvSharePct,
		gridBalanceDischargeKwh,
		nonMonetized: {
			thermalElectricalInputKwh: immersion.energyKwh,
			gridBalanceDischargeKwh,
			pelletReliefKwh: null,
			avoidedBoilerStarts: null,
			wearValueEur: null,
			notesDe: [
				"Wärmespeicherung und Netzausgleich werden energetisch gezeigt, aber nicht automatisch in Euro umgerechnet.",
				"Pelletentlastung, vermiedene Kesselstarts und Verschleiß bleiben ohne belastbare Messquelle unbewertet.",
			],
		},
		notesDe,
	};
}

function sumField(days: EnergeticDayTotals[], pick: (day: EnergeticDayTotals) => number | null): number | null {
	let total = 0;
	let count = 0;
	for (const day of days) {
		const value = pick(day);
		if (!finite(value)) continue;
		total += value;
		count += 1;
	}
	return count > 0 ? round3(total) : null;
}

function strictPvAggregate(
	days: EnergeticDayTotals[],
	energy: (day: EnergeticDayTotals) => number | null,
	pv: (day: EnergeticDayTotals) => number | null,
): PvAttribution {
	const relevant = days.filter((day) => (energy(day) ?? 0) > 0);
	const energyKwh = sumField(days, energy);
	if (relevant.some((day) => pv(day) === null)) {
		return { energyKwh, pvKwh: null, pvSharePct: null };
	}
	const pvKwh = sumField(days, pv);
	return { energyKwh, pvKwh, pvSharePct: percentage(pvKwh, energyKwh) };
}

export function sumEnergeticDays(
	days: Array<EnergeticDayTotals | null | undefined>,
	meta: { period: string; periodLabelDe: string; fromKey: string; toKey: string },
): EnergeticPeriodSummary {
	const available = days.filter((day): day is EnergeticDayTotals => !!day);
	const selfConsumptionKwh = sumField(available, (day) => day.selfConsumptionKwh);
	const selfBasis = sumField(available, (day) => day.selfConsumptionPvBasisKwh);
	const autonomyNonGrid = sumField(available, (day) =>
		finite(day.autonomyConsumptionBasisKwh) && finite(day.autonomyGridImportBasisKwh)
			? Math.max(0, day.autonomyConsumptionBasisKwh - day.autonomyGridImportBasisKwh)
			: null,
	);
	const autonomyBasis = sumField(available, (day) => day.autonomyConsumptionBasisKwh);
	const battery = strictPvAggregate(available, (day) => day.batteryChargedKwh, (day) => day.batteryPvChargedKwh);
	const immersion = strictPvAggregate(available, (day) => day.immersionEnergyKwh, (day) => day.immersionPvKwh);
	const ev = strictPvAggregate(available, (day) => day.evChargedKwh, (day) => day.evPvKwh);
	const fastModeIncomplete = available.some(
		(day) => (day.evChargedKwh ?? 0) > 0 && !finite(day.evFastChargedKwh),
	);
	const evFastEnergyKwh = fastModeIncomplete
		? null
		: sumField(available, (day) => day.evFastChargedKwh);
	const fastRelevant = available.filter((day) => (day.evFastChargedKwh ?? 0) > 0);
	const evFastBatteryKwh = fastModeIncomplete || fastRelevant.some((day) => !finite(day.evFastBatteryKwh))
		? null
		: sumField(available, (day) => day.evFastBatteryKwh);
	const evFastGridKwh = fastModeIncomplete || fastRelevant.some((day) => !finite(day.evFastGridKwh))
		? null
		: sumField(available, (day) => day.evFastGridKwh);
	const evFastLocalKwh = fastModeIncomplete || fastRelevant.some((day) => !finite(day.evFastLocalKwh))
		? null
		: sumField(available, (day) => day.evFastLocalKwh);
	const climate = strictPvAggregate(available, (day) => day.climateEnergyKwh, (day) => day.climatePvKwh);
	const gridBalanceDischargeKwh = sumField(available, (day) => day.gridBalanceDischargeKwh);
	const notesDe: string[] = [];
	if (available.length === 0) notesDe.push("Für diesen Zeitraum liegt noch keine Day-Telemetry vor.");
	else if (available.length < days.length) notesDe.push(`${available.length} von ${days.length} Tagen enthalten Energiemesswerte.`);
	if (available.some((day) => !day.complete || !day.evaluable)) {
		notesDe.push("Der Zeitraum enthält laufende oder noch nicht vollständig bewertbare Tage.");
	}
	if (fastModeIncomplete) {
		notesDe.push("Schnellmodus-Anteil im Zeitraum nicht bestimmbar: Mindestens einem Ladetag fehlt die EVCC-Modusspur.");
	} else if (fastRelevant.some((day) => !finite(day.evFastBatteryKwh) || !finite(day.evFastGridKwh))) {
		notesDe.push("Schnellmodus-Quellen im Zeitraum nicht bestimmbar: Mindestens einem Schnellladetag fehlt die vollständige Quellenmessung.");
	}

	return {
		...meta,
		daysTotal: days.length,
		daysWithTelemetry: available.length,
		daysEvaluable: available.filter((day) => day.complete && day.evaluable).length,
		pvGenerationKwh: sumField(available, (day) => day.pvGenerationKwh),
		houseConsumptionKwh: sumField(available, (day) => day.houseConsumptionKwh),
		gridImportKwh: sumField(available, (day) => day.gridImportKwh),
		gridExportKwh: sumField(available, (day) => day.gridExportKwh),
		selfConsumptionKwh,
		selfConsumptionPct: percentage(selfConsumptionKwh, selfBasis),
		autonomyPct: percentage(autonomyNonGrid, autonomyBasis),
		batteryChargedKwh: battery.energyKwh,
		batteryDischargedKwh: sumField(available, (day) => day.batteryDischargedKwh),
		batteryPvChargedKwh: battery.pvKwh,
		batteryPvSharePct: battery.pvSharePct,
		batteryMeasuredLossKwh: sumField(available, (day) => day.batteryMeasuredLossKwh),
		immersionEnergyKwh: immersion.energyKwh,
		immersionPvKwh: immersion.pvKwh,
		immersionPvSharePct: immersion.pvSharePct,
		evChargedKwh: ev.energyKwh,
		evPvKwh: ev.pvKwh,
		evPvSharePct: ev.pvSharePct,
		evFastChargedKwh: evFastEnergyKwh,
		evFastBatteryKwh,
		evFastBatterySharePct: percentage(evFastBatteryKwh, evFastEnergyKwh),
		evFastGridKwh,
		evFastGridSharePct: percentage(evFastGridKwh, evFastEnergyKwh),
		evFastLocalKwh,
		evFastLocalSharePct: percentage(evFastLocalKwh, evFastEnergyKwh),
		climateEnergyKwh: climate.energyKwh,
		climatePvKwh: climate.pvKwh,
		climatePvSharePct: climate.pvSharePct,
		gridBalanceDischargeKwh,
		nonMonetized: {
			thermalElectricalInputKwh: immersion.energyKwh,
			gridBalanceDischargeKwh,
			pelletReliefKwh: null,
			avoidedBoilerStarts: null,
			wearValueEur: null,
			notesDe: [
				"Thermische Verschiebung und Netzausgleich sind Energiemengen, keine automatisch behauptete Euro-Ersparnis.",
				"Pellet-, Kesselstart- und Verschleißnutzen bleiben bis zu einer belastbaren Messgrundlage unmonetarisiert.",
			],
		},
		notesDe,
	};
}
