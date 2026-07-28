/**
 * Outdoor→Laufzeit/kWh-Schätzung für Klima (kühl + entfeuchten).
 * Keine 15-Min-Slot-Pflicht — nur Energie-/Stundenbedarf für Forecast/Briefing.
 */

export function outdoorDriveFactor(outdoorMaxC: number | null, outdoorLikelyTempC: number): number {
	if (outdoorMaxC === null || !Number.isFinite(outdoorMaxC)) return 0;
	if (outdoorMaxC < outdoorLikelyTempC - 2) return 0;
	if (outdoorMaxC < outdoorLikelyTempC) return 0.35;
	if (outdoorMaxC < outdoorLikelyTempC + 3) return 0.55;
	if (outdoorMaxC < outdoorLikelyTempC + 6) return 0.75;
	return 0.95;
}

export function estimateCoolingHours(input: {
	outdoorMaxC: number | null;
	outdoorLikelyTempC: number;
	remainingHours: number;
	learnedHours: number | null;
	roomTempC: number | null;
	onTempC: number;
	offTempC: number;
}): { likelyActive: boolean; expectedHours: number; reasonDe: string } {
	const remaining = Math.max(0, input.remainingHours);
	if (remaining <= 0) {
		return { likelyActive: false, expectedHours: 0, reasonDe: "Außerhalb Zeitfenster." };
	}

	const factor = outdoorDriveFactor(input.outdoorMaxC, input.outdoorLikelyTempC);
	const learned =
		input.learnedHours !== null && input.learnedHours > 0 ? input.learnedHours : null;
	const room = input.roomTempC;

	if (room !== null && room >= input.onTempC) {
		const hours = Math.min(remaining, learned ?? remaining * Math.max(0.5, factor || 0.7));
		return {
			likelyActive: true,
			expectedHours: round2(hours),
			reasonDe: `Raum ${room.toFixed(1)} °C ≥ ${input.onTempC} °C`,
		};
	}

	if (factor <= 0 && (room === null || room <= input.offTempC)) {
		return {
			likelyActive: false,
			expectedHours: 0,
			reasonDe:
				input.outdoorMaxC !== null
					? `Außen-Max ${input.outdoorMaxC.toFixed(1)} °C unter ${input.outdoorLikelyTempC} °C`
					: room !== null
						? `Raum ${room.toFixed(1)} °C unter Ein-Schwelle ${input.onTempC} °C`
						: "Keine Temp-Daten",
		};
	}

	if (factor > 0) {
		const base = learned ?? remaining * factor;
		const hours = Math.min(remaining, base);
		const likely = hours >= 0.25;
		return {
			likelyActive: likely,
			expectedHours: likely ? round2(hours) : 0,
			reasonDe:
				input.outdoorMaxC !== null
					? `Außen-Max ${input.outdoorMaxC.toFixed(1)} °C → ~${round2(hours)} h Kühlung`
					: `Kühlbedarf (Faktor ${factor})`,
		};
	}

	if (room !== null && room > input.offTempC && learned !== null && learned >= 0.5) {
		const hours = Math.min(remaining, learned);
		return {
			likelyActive: true,
			expectedHours: round2(hours),
			reasonDe: `Raum ${room.toFixed(1)} °C in Hysterese — historisch ${round2(learned)} h/Tag`,
		};
	}

	return {
		likelyActive: false,
		expectedHours: 0,
		reasonDe:
			room !== null
				? `Raum ${room.toFixed(1)} °C unter Ein-Schwelle ${input.onTempC} °C`
				: "Kein Kühlbedarf",
	};
}

export function estimateDehumidifyHours(input: {
	outdoorMaxC: number | null;
	outdoorLikelyTempC: number;
	remainingHours: number;
	learnedHours: number | null;
	roomHumidityPct: number | null;
	maxHumidityPct: number | null;
	dryModeConfigured: boolean;
}): { likelyActive: boolean; expectedHours: number; reasonDe: string } {
	if (!input.dryModeConfigured || input.maxHumidityPct === null) {
		return { likelyActive: false, expectedHours: 0, reasonDe: "Entfeuchten nicht konfiguriert." };
	}
	const remaining = Math.max(0, input.remainingHours);
	if (remaining <= 0) {
		return { likelyActive: false, expectedHours: 0, reasonDe: "Außerhalb Zeitfenster." };
	}

	const humidity = input.roomHumidityPct;
	const learned =
		input.learnedHours !== null && input.learnedHours > 0 ? input.learnedHours * 0.5 : null;

	if (humidity !== null && humidity >= input.maxHumidityPct) {
		const hours = Math.min(remaining, learned ?? remaining * 0.45);
		return {
			likelyActive: true,
			expectedHours: round2(hours),
			reasonDe: `Feuchte ${humidity.toFixed(0)} % ≥ ${input.maxHumidityPct} %`,
		};
	}

	// Warme Tage → typisch mehr Feuchtebedarf, auch ohne aktuelle Feuchte-Messung.
	const factor = outdoorDriveFactor(input.outdoorMaxC, input.outdoorLikelyTempC);
	if (factor >= 0.55) {
		const hours = Math.min(remaining, learned ?? remaining * factor * 0.35);
		if (hours >= 0.25) {
			return {
				likelyActive: true,
				expectedHours: round2(hours),
				reasonDe:
					input.outdoorMaxC !== null
						? `Außen-Max ${input.outdoorMaxC.toFixed(1)} °C → ~${round2(hours)} h Entfeuchten`
						: `Entfeuchten ~${round2(hours)} h`,
			};
		}
	}

	return {
		likelyActive: false,
		expectedHours: 0,
		reasonDe:
			humidity !== null
				? `Feuchte ${humidity.toFixed(0)} % unter ${input.maxHumidityPct} %`
				: "Kein Entfeuchtungsbedarf",
	};
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}
