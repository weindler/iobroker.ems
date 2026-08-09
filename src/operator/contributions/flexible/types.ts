import type { OperatorDataQuality, OperatorDataStatus } from "../../types";
import { operatorQuality } from "../../quality";

export interface ParticipationInput {
	addonEnabled: boolean;
	governanceEnabled: boolean;
	configured: boolean;
	mappingsReady: boolean;
	fault: boolean;
	lockout: boolean;
	globalModeOff: boolean;
	/**
	 * Add-on execution mode = off — EMS übernimmt nicht (Participation-Gate, kein reines Write-Gate).
	 * Telemetrie/Hausbilanz bleiben erlaubt; keine Flex-Contribution.
	 */
	addonExecutionOff?: boolean;
	telemetryValid?: boolean;
	telemetryStale?: boolean;
	unsupported?: boolean;
}

export interface ParticipationResult {
	allowed: boolean;
	status: OperatorDataStatus;
	reasonDe: string;
}

export function evaluateParticipation(input: ParticipationInput): ParticipationResult {
	if (input.unsupported) {
		return { allowed: false, status: "unsupported", reasonDe: "Funktion durch Profil nicht unterstützt." };
	}
	if (!input.addonEnabled) {
		return { allowed: false, status: "disabled", reasonDe: "Add-on deaktiviert." };
	}
	if (!input.governanceEnabled) {
		return { allowed: false, status: "disabled", reasonDe: "Governance deaktiviert." };
	}
	if (input.addonExecutionOff === true) {
		return {
			allowed: false,
			status: "disabled",
			reasonDe: "Add-on-Modus Aus — EMS-Light übernimmt dieses Gerät nicht.",
		};
	}
	if (input.globalModeOff) {
		return { allowed: false, status: "disabled", reasonDe: "Global Mode off — keine flexiblen Contributions." };
	}
	if (input.fault) {
		return { allowed: false, status: "blocked", reasonDe: "Gerätestörung (Fault) aktiv." };
	}
	if (input.lockout) {
		return { allowed: false, status: "blocked", reasonDe: "Gerät im Lockout." };
	}
	if (!input.configured) {
		return { allowed: false, status: "missing", reasonDe: "Add-on nicht konfiguriert." };
	}
	if (!input.mappingsReady) {
		return { allowed: false, status: "missing", reasonDe: "Erforderliche Mappings fehlen." };
	}
	if (input.telemetryValid === false) {
		return { allowed: false, status: "invalid", reasonDe: "Telemetrie ungültig." };
	}
	if (input.telemetryStale) {
		return { allowed: false, status: "degraded", reasonDe: "Telemetrie veraltet." };
	}
	return { allowed: true, status: "valid", reasonDe: "Teilnahmebedingungen erfüllt." };
}

export function participationQuality(result: ParticipationResult): OperatorDataQuality {
	return operatorQuality(result.status, result.reasonDe);
}

export function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/** Max. Ladeleistung Wallbox aus Phasen × Spannung × Strom (keine Phasenumschaltung). */
export function wallboxMaxChargePowerW(phases: number | null, maxCurrentA: number | null, voltage = 230): number | null {
	if (phases === null || maxCurrentA === null || phases <= 0 || maxCurrentA <= 0) return null;
	return Math.round(phases * voltage * maxCurrentA);
}

export function flexibleContributionsRevisionPayload(contributions: Array<{ contributionId: string; enabled: boolean; quality: OperatorDataQuality; details: Record<string, unknown>; slots: unknown[] }>): string {
	return JSON.stringify(
		contributions.map((c) => ({
			contributionId: c.contributionId,
			enabled: c.enabled,
			quality: c.quality,
			details: c.details,
			slots: (c.slots as Array<Record<string, unknown>>).map((slot) => {
				const { slot: _time, ...rest } = slot as { slot?: unknown };
				return rest;
			}),
		})),
	);
}
