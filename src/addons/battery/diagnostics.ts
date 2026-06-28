import type { BatteryConfig } from "./config";
import { deriveEnergy, resolveCapacity } from "./core/capacity";
import { normalizeTelemetry, type RawBatteryReading } from "./core/telemetry";
import type {
	BatteryCapacityResult,
	BatteryEnergyDerived,
	BatteryHardwareLimits,
	BatteryIdentity,
	BatteryProfileId,
	BatteryTelemetry,
	BatteryTelemetryQuality,
	CapabilityMatrix,
} from "./core/types";
import { missingMappings, type BatteryMappingTable } from "./mapping";
import type { BatteryProfile, ProfileReadiness } from "./profiles/types";

export interface BatterySnapshot {
	profileId: BatteryProfileId;
	identity: BatteryIdentity;
	telemetry: BatteryTelemetry;
	quality: BatteryTelemetryQuality;
	capacity: BatteryCapacityResult;
	energy: BatteryEnergyDerived;
	limits: BatteryHardwareLimits;
	capabilities: CapabilityMatrix;
	readiness: ProfileReadiness;
	effectiveExecutionMode: "dryrun" | "live";
	missingMappings: string[];
}

export interface AssembleSnapshotInput {
	config: BatteryConfig;
	mapping: BatteryMappingTable;
	profile: BatteryProfile;
	reading: RawBatteryReading;
	mappedCapacityKwh: number | null;
	nowMs: number;
	globalLive: boolean;
	governanceEnabled: boolean;
	requiredValues?: Array<"soc" | "power" | "capacity" | "mode">;
}

export function assembleBatterySnapshot(input: AssembleSnapshotInput): BatterySnapshot {
	const { config, mapping, profile, reading, nowMs } = input;
	const limits = config.limits;
	const profileInput = { config, mapping, limits };

	const capacity = resolveCapacity({
		source: config.capacitySource,
		manualKwh: config.capacityManualKwh,
		mappedKwh: input.mappedCapacityKwh,
	});

	const effectiveReading: RawBatteryReading = {
		...reading,
		capacityNetKwh: capacity.effectiveKwh,
	};

	const { telemetry, quality } = normalizeTelemetry({
		reading: effectiveReading,
		signConvention: config.signConvention,
		nowMs,
		maxAgeMs: config.telemetryMaxAgeMs,
		requiredValues: input.requiredValues,
	});

	const energy = deriveEnergy(telemetry.socPct, capacity.effectiveKwh, limits.minSocPct);
	const capabilities = profile.buildCapabilities(profileInput);
	const readiness = profile.computeReadiness(profileInput);

	const identity: BatteryIdentity = {
		manufacturer: config.manufacturer,
		model: config.model,
		controllerProfile: config.profile,
		capacityNetKwh: capacity.effectiveKwh,
		capacitySource: capacity.source,
	};

	const live =
		input.globalLive && input.governanceEnabled && readiness.liveReady && profile.supportsLive;

	const allRequired = [...profile.requiredReadRoles, ...profile.requiredWriteRoles];
	const missing = missingMappings(mapping, allRequired).map((r) => r as string);

	return {
		profileId: profile.id,
		identity,
		telemetry,
		quality,
		capacity,
		energy,
		limits,
		capabilities,
		readiness,
		effectiveExecutionMode: live ? "live" : "dryrun",
		missingMappings: missing,
	};
}
