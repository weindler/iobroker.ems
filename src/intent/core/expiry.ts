import type { ManualOverrideState } from "./types";
import { isExpiredAt } from "./validation";

const MIN_EXPIRY_MS = 5_000;
const MAX_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function collectExpiryTimes(now: Date, overrides: (ManualOverrideState | null | undefined)[]): number[] {
	const times: number[] = [];
	for (const o of overrides) {
		if (!o?.active || !o.valid_until) continue;
		const t = Date.parse(o.valid_until);
		if (Number.isFinite(t) && t > now.getTime()) {
			times.push(t);
		}
	}
	return times;
}

export function nextExpiryDelayMs(now: Date, expiryTimes: number[]): number | null {
	if (expiryTimes.length === 0) return null;
	const next = Math.min(...expiryTimes);
	const delay = next - now.getTime();
	if (delay <= 0) return MIN_EXPIRY_MS;
	return Math.min(Math.max(delay, MIN_EXPIRY_MS), MAX_EXPIRY_MS);
}

export function shouldRerunAfterExpiry(validUntil: string | undefined, now: Date): boolean {
	if (!validUntil) return false;
	return isExpiredAt(validUntil, now);
}
