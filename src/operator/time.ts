import { MS_PER_15MIN } from "../learning/price_forecast/tibber_parse";

export const OPERATOR_MS_PER_15MIN = MS_PER_15MIN;

export function isoFromMs(ms: number): string {
	return new Date(ms).toISOString();
}

export function slotEndMsFromStart(startMs: number): number {
	return startMs + OPERATOR_MS_PER_15MIN;
}

export function isValidIsoTimestamp(iso: string): boolean {
	if (!iso.trim()) return false;
	const ms = Date.parse(iso);
	return Number.isFinite(ms);
}
