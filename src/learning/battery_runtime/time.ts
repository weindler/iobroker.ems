export function parseTimeHHMM(value: string): { hour: number; minute: number } | null {
	const m = value.match(/^(\d{1,2}):(\d{2})$/);
	if (!m) return null;
	const hour = parseInt(m[1], 10);
	const minute = parseInt(m[2], 10);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
	return { hour, minute };
}

export function localDateKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Nachtfenster über Mitternacht, z. B. 22:00–06:00. */
export function isInNightWindow(
	hour: number,
	nightStartHour: number,
	nightEndHour: number,
): boolean {
	if (nightStartHour === nightEndHour) return false;
	if (nightStartHour < nightEndHour) {
		return hour >= nightStartHour && hour < nightEndHour;
	}
	return hour >= nightStartHour || hour < nightEndHour;
}

export function timestampAtLocalTime(dateKey: string, hour: number, minute: number): number {
	const [y, m, d] = dateKey.split("-").map((x) => parseInt(x, 10));
	return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
}
