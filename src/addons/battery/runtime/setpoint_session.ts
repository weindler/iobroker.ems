/**
 * Einheitlicher Batterie-Setpoint-Release (alle EMS-Pfade, die control.charge > 0 schreiben).
 *
 * Vertrag:
 *   eigener erfolgreicher Leistungs-Write > 0 → Ownership → reguläres Aktionsende
 *   → genau ein Release-Write 0 W → Ownership frei.
 *
 * Kein 0-W-Write gegen eine neue Authority (Hold / External / Restore-Fault /
 * höhere Batterieaktion) — Ownership wird nur abgegeben.
 *
 * Ohne Ownership (z. B. Adapterrestart mit altem Geräte-Setpoint) kein Blind-0.
 */

import type { BatteryAction } from "../core/types";

export type BatterySetpointOwner = "none" | "grid_balance" | "grid_charge" | "planned_charge";

export type BatterySetpointHandover = "none" | "hold" | "external" | "restore_fault" | "higher_priority";

export interface BatterySetpointSession {
	owner: BatterySetpointOwner;
	setpointW: number;
	wrotePositive: boolean;
	wroteLive: boolean;
	releasePending: boolean;
	releaseReason: string;
	lastReleaseAt: string | null;
}

export function emptySetpointSession(): BatterySetpointSession {
	return {
		owner: "none",
		setpointW: 0,
		wrotePositive: false,
		wroteLive: false,
		releasePending: false,
		releaseReason: "",
		lastReleaseAt: null,
	};
}

export function setpointOwnerFromAction(action: BatteryAction | "grid_balance" | null | undefined): BatterySetpointOwner {
	if (action === "grid_balance") return "grid_balance";
	if (action === "grid_charge") return "grid_charge";
	if (action === "charge" || action === "topoff") return "planned_charge";
	return "none";
}

export function resolveBatterySetpointHandover(input: {
	hold: boolean;
	external: boolean;
	restoreOrFault: boolean;
	higherPriority: boolean;
}): BatterySetpointHandover {
	if (input.restoreOrFault) return "restore_fault";
	if (input.external) return "external";
	if (input.hold) return "hold";
	if (input.higherPriority) return "higher_priority";
	return "none";
}

/** Nur nach akzeptiertem Write (executed / written / simulated) mit powerW > 0. */
export function notePositiveSetpointWrite(
	session: BatterySetpointSession,
	owner: BatterySetpointOwner,
	powerW: number,
	live: boolean,
): BatterySetpointSession {
	if (owner === "none" || !(powerW > 0) || !Number.isFinite(powerW)) return session;
	return {
		...session,
		owner,
		setpointW: Math.round(powerW),
		wrotePositive: true,
		wroteLive: live || session.wroteLive,
		releasePending: false,
		releaseReason: "",
	};
}

export function decideSetpointRelease(input: {
	session: BatterySetpointSession;
	handover: BatterySetpointHandover;
	regularEnd: boolean;
}): { shouldWriteZero: boolean; dropOwnership: boolean; reason: string } {
	const owns = input.session.owner !== "none" && input.session.wrotePositive;
	if (!owns) {
		return { shouldWriteZero: false, dropOwnership: false, reason: "no_ownership" };
	}
	if (input.handover !== "none") {
		return { shouldWriteZero: false, dropOwnership: true, reason: `handover_${input.handover}` };
	}
	if (!input.regularEnd) {
		return { shouldWriteZero: false, dropOwnership: false, reason: "" };
	}
	if (input.session.setpointW <= 0) {
		return { shouldWriteZero: false, dropOwnership: true, reason: "already_released" };
	}
	return { shouldWriteZero: true, dropOwnership: true, reason: "regular_end" };
}

export function markReleasePending(session: BatterySetpointSession, reason: string): BatterySetpointSession {
	if (session.owner === "none" || !session.wrotePositive) return session;
	return { ...session, releasePending: true, releaseReason: reason };
}

export function applyZeroRelease(
	session: BatterySetpointSession,
	nowIso: string,
	reason: string,
): BatterySetpointSession {
	return {
		owner: "none",
		setpointW: 0,
		wrotePositive: false,
		wroteLive: false,
		releasePending: false,
		releaseReason: reason,
		lastReleaseAt: nowIso,
	};
}

/** Authority-Übergabe: kein 0-Write, Ownership frei. */
export function applyHandover(
	session: BatterySetpointSession,
	reason: string,
): BatterySetpointSession {
	return {
		owner: "none",
		setpointW: 0,
		wrotePositive: false,
		wroteLive: false,
		releasePending: false,
		releaseReason: reason,
		lastReleaseAt: session.lastReleaseAt,
	};
}

let held: BatterySetpointSession = emptySetpointSession();
let failsafeTookOver = false;

export function getBatterySetpointSession(): BatterySetpointSession {
	return held;
}

export function setBatterySetpointSession(next: BatterySetpointSession): void {
	held = next;
}

export function resetBatterySetpointSession(): void {
	held = emptySetpointSession();
	failsafeTookOver = false;
}

/** Failsafe hat 0 W geschrieben — FSM/GB dürfen nicht gegen diese Restore-Authority aufräumen. */
export function markFailsafeSetpointTakeover(nowIso: string): void {
	held = applyZeroRelease(held, nowIso, "failsafe");
	failsafeTookOver = true;
}

export function consumeFailsafeSetpointTakeover(): boolean {
	const v = failsafeTookOver;
	failsafeTookOver = false;
	return v;
}
