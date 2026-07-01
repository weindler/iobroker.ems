import { parseFreezeTimeHHMM } from "./config";

/** Lokales Kalenderdatum YYYY-MM-DD. */
export function localDateKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Zeitpunkt des Freeze an einem Referenztag (lokale Zeit) in ms. */
export function freezeInstantMs(freezeTime: string, ref: Date): number | null {
	const parsed = parseFreezeTimeHHMM(freezeTime);
	if (!parsed) {
		return null;
	}
	const d = new Date(ref);
	d.setHours(parsed.hours, parsed.minutes, 0, 0);
	return d.getTime();
}
