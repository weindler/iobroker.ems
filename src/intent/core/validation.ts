import type { IntentFieldStatus } from "./types";

export function isFiniteNumber(n: number): boolean {
	return Number.isFinite(n);
}

export function parseOptionalSoc(raw: unknown): { value: number | null; status: IntentFieldStatus } {
	if (raw === null || raw === undefined || raw === "") {
		return { value: null, status: "missing" };
	}
	const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", ".").trim());
	if (!Number.isFinite(n)) {
		return { value: null, status: "invalid" };
	}
	if (n < 0 || n > 100) {
		return { value: null, status: "invalid" };
	}
	return { value: n, status: "valid" };
}

export function isExpiredAt(iso: string | undefined, now: Date): boolean {
	if (!iso) {
		return false;
	}
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) {
		return false;
	}
	return t < now.getTime();
}

export function candidateUsable(status: IntentFieldStatus, validUntil: string | undefined, now: Date): boolean {
	if (status === "invalid" || status === "missing") {
		return false;
	}
	if (status === "expired") {
		return false;
	}
	if (validUntil && isExpiredAt(validUntil, now)) {
		return false;
	}
	return status === "valid";
}
