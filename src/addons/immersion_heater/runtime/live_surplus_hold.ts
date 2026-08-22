import type { ImmersionDeviceConfig } from "./types";

export interface ImmersionLiveSurplusHoldInput {
	pvPowerW: number | null;
	houseLoadW: number | null;
	/** Gemessene oder laufende IH-Leistung — Hauslast enthält IH bereits. */
	immersionOnPowerW: number | null;
	bufferTempC: number | null;
	targetTempC: number | null;
	planningMaxTempC: number;
	/** Heizstab lief im vorherigen Tick oder läuft noch. */
	continueHeating: boolean;
	config: ImmersionDeviceConfig;
}

export interface ImmersionLiveSurplusHoldResult {
	active: boolean;
	effectiveSurplusW: number | null;
	reasonDe: string;
	stageIndex: number | null;
	stagePowerW: number | null;
}

export function computeEffectivePvSurplusW(
	pvPowerW: number | null,
	houseLoadW: number | null,
	immersionOnPowerW: number | null,
): number | null {
	if (pvPowerW === null || houseLoadW === null) return null;
	if (!Number.isFinite(pvPowerW) || !Number.isFinite(houseLoadW)) return null;
	const ih = Math.max(0, immersionOnPowerW ?? 0);
	return Math.round(pvPowerW - houseLoadW + ih);
}

export function minEnabledImmersionStage(
	config: ImmersionDeviceConfig,
): { stageIndex: number; nominalPowerW: number } | null {
	const enabled = config.stages.filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId);
	if (enabled.length === 0) return null;
	const min = [...enabled].sort((a, b) => a.nominalPowerW - b.nominalPowerW)[0];
	return { stageIndex: min.index, nominalPowerW: min.nominalPowerW };
}

export function computeImmersionLiveSurplusHold(
	input: ImmersionLiveSurplusHoldInput,
): ImmersionLiveSurplusHoldResult {
	const surplus = computeEffectivePvSurplusW(
		input.pvPowerW,
		input.houseLoadW,
		input.immersionOnPowerW,
	);
	const minStage = minEnabledImmersionStage(input.config);

	const inactive = (reasonDe: string): ImmersionLiveSurplusHoldResult => ({
		active: false,
		effectiveSurplusW: surplus,
		reasonDe,
		stageIndex: null,
		stagePowerW: null,
	});

	if (!input.continueHeating) {
		return inactive("Live-Surplus-Hold: Heizstab nicht aktiv (kein Durchlauf).");
	}
	if (!minStage) {
		return inactive("Live-Surplus-Hold: keine konfigurierte Stufe.");
	}
	if (input.bufferTempC === null || !Number.isFinite(input.bufferTempC)) {
		return inactive("Live-Surplus-Hold: Puffertemperatur fehlt.");
	}

	const targetC =
		input.targetTempC !== null && Number.isFinite(input.targetTempC)
			? Math.min(input.planningMaxTempC, input.targetTempC)
			: input.planningMaxTempC;

	if (input.bufferTempC >= input.planningMaxTempC - 0.05) {
		return inactive("Live-Surplus-Hold: Planungs-Maxtemperatur erreicht.");
	}
	if (input.bufferTempC >= targetC - 0.05) {
		return inactive("Live-Surplus-Hold: Tagesziel erreicht.");
	}
	if (surplus === null) {
		return inactive("Live-Surplus-Hold: Live-PV/Hauslast fehlt.");
	}
	if (surplus + 1 < minStage.nominalPowerW * 0.95) {
		return inactive(
			`Live-Surplus-Hold: Überschuss ${surplus} W unter Stufe ${minStage.nominalPowerW} W.`,
		);
	}

	return {
		active: true,
		effectiveSurplusW: surplus,
		reasonDe: `Live-PV-Überschuss ${surplus} W — Durchlauf bei anhaltendem Überschuss (Stufe ${minStage.stageIndex}, ${minStage.nominalPowerW} W).`,
		stageIndex: minStage.stageIndex,
		stagePowerW: minStage.nominalPowerW,
	};
}
