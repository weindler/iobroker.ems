/** Lokale Stunden-ID (Adapter-Zeitzone). */
export function localHourKey(ts: number): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	const h = String(d.getHours()).padStart(2, "0");
	return `${y}-${m}-${day}T${h}`;
}

/** Start-Timestamp der lokalen Stunde. */
export function hourKeyToStartTs(hourKey: string): number {
	const [datePart, hourPart] = hourKey.split("T");
	const [y, m, d] = datePart.split("-").map((x) => parseInt(x, 10));
	return new Date(y, m - 1, d, parseInt(hourPart, 10), 0, 0, 0).getTime();
}
