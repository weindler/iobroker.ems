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
	/** %-Punkte unter maxHumidityPct für Dry-Aus (Hysterese). */
	humidityOffHysteresisPct: number;
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
	/** @deprecated prefer cleaningAfterCooling/Dehumidify/Heating */
	cleaningAfterRun: boolean;
	cleaningAfterCooling: boolean;
	cleaningAfterDehumidify: boolean;
	cleaningAfterHeating: boolean;
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
