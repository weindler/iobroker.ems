import type { AcProfileId } from "./constants";

export type AcUnitModePurpose = "cooling" | "dehumidify" | "fan_only" | "heating";

export type AcUnitConfig = {
	index: number;
	enabled: boolean;
	name: string;
	profileId: AcProfileId;
	onTempC: number;
	offTempC: number;
	maxHumidityPct: number | null;
	coolingSetpointC: number;
	modeWhenCooling: string;
	fanModeWhenCooling: string;
	fanSpeedWhenCooling: string;
	modeWhenDehumidify: string;
	fanModeWhenDehumidify: string;
	modeWhenFanOnly: string;
	fanModeWhenFanOnly: string;
	modeWhenHeating: string;
	fanModeWhenHeating: string;
	heatSetpointC: number | null;
	activeFrom: string;
	activeUntil: string;
	hardOffAt: string;
	estimatedPowerW: number;
	cleaningAfterRun: boolean;
	cleaningDelayMin: number;
	cleaningDurationMin: number;
	statsEnabled: boolean;
	statsTrackRuntime: boolean;
	statsTrackEnergy: boolean;
	statsRuntimeOffsetSec: number;
	statsEnergyOffsetKwh: number;
};

export type AcGlobalConfig = {
	outdoorMaxPowerW: number;
	/** Ab dieser Außentemp. (°C) Klima wahrscheinlich, wenn kein Raumsensor. */
	plannerOutdoorLikelyTempC: number;
	defaultProfileId: AcProfileId;
	units: AcUnitConfig[];
};
