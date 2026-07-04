/** Minuten seit Mitternacht aus HH:MM oder HH:MM:SS. */
export function parseClockToMinutes(raw: string): number | null {
	const m = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
	if (!m) return null;
	const h = parseInt(m[1], 10);
	const min = parseInt(m[2], 10);
	if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
	return h * 60 + min;
}

export function localMinutesNow(d: Date): number {
	return d.getHours() * 60 + d.getMinutes();
}

export function isWithinClockWindow(nowMin: number, fromRaw: string, untilRaw: string): boolean {
	const from = parseClockToMinutes(fromRaw);
	const until = parseClockToMinutes(untilRaw);
	if (from === null || until === null) return true;
	if (from <= until) {
		return nowMin >= from && nowMin < until;
	}
	return nowMin >= from || nowMin < until;
}

export function isHardOffTime(nowMin: number, hardOffRaw: string): boolean {
	const off = parseClockToMinutes(hardOffRaw);
	if (off === null) return false;
	return nowMin >= off;
}

export function switchIsOn(raw: unknown): boolean {
	const s = String(raw ?? "").trim().toLowerCase();
	return s === "on" || s === "true" || s === "1";
}

export function switchIsOff(raw: unknown): boolean {
	const s = String(raw ?? "").trim().toLowerCase();
	return s === "off" || s === "false" || s === "0" || s === "";
}
