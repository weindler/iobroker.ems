import type { BatteryConfig } from "../config";
import type { BatteryMappingRole, BatteryMappingTable } from "../mapping";
import type {
	BatteryHardwareLimits,
	BatteryOperatingMode,
	BatteryProfileId,
	CapabilityMatrix,
} from "../core/types";

export interface ProfileBuildInput {
	config: BatteryConfig;
	mapping: BatteryMappingTable;
	limits: BatteryHardwareLimits;
}

export interface ProfileReadiness {
	telemetryReady: boolean;
	controlReady: boolean;
	dryrunReady: boolean;
	liveReady: boolean;
	reason: string;
	missingRequired: BatteryMappingRole[];
}

export interface BatteryProfile {
	id: BatteryProfileId;
	displayNameDe: string;
	displayNameEn: string;
	supportsRead: boolean;
	supportsDryrun: boolean;
	supportsLive: boolean;
	/** Pflicht-Lesemappings für gültige Telemetrie. */
	requiredReadRoles: BatteryMappingRole[];
	/** Pflicht-Schreibmappings für Live-Steuerung. */
	requiredWriteRoles: BatteryMappingRole[];
	normalizeOperatingMode(raw: unknown, input: ProfileBuildInput): BatteryOperatingMode;
	buildCapabilities(input: ProfileBuildInput): CapabilityMatrix;
	computeReadiness(input: ProfileBuildInput): ProfileReadiness;
}
