"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assembleBatterySnapshot = void 0;
const capacity_1 = require("./core/capacity");
const telemetry_1 = require("./core/telemetry");
const mapping_1 = require("./mapping");
function assembleBatterySnapshot(input) {
    const { config, mapping, profile, reading, nowMs } = input;
    const limits = config.limits;
    const profileInput = { config, mapping, limits };
    const capacity = (0, capacity_1.resolveCapacity)({
        source: config.capacitySource,
        manualKwh: config.capacityManualKwh,
        mappedKwh: input.mappedCapacityKwh,
    });
    const effectiveReading = {
        ...reading,
        capacityNetKwh: capacity.effectiveKwh,
    };
    const { telemetry, quality } = (0, telemetry_1.normalizeTelemetry)({
        reading: effectiveReading,
        signConvention: config.signConvention,
        nowMs,
        maxAgeMs: config.telemetryMaxAgeMs,
        requiredValues: input.requiredValues,
    });
    const energy = (0, capacity_1.deriveEnergy)(telemetry.socPct, capacity.effectiveKwh, limits.minSocPct);
    const capabilities = profile.buildCapabilities(profileInput);
    const readiness = profile.computeReadiness(profileInput);
    const identity = {
        manufacturer: config.manufacturer,
        model: config.model,
        controllerProfile: config.profile,
        capacityNetKwh: capacity.effectiveKwh,
        capacitySource: capacity.source,
    };
    const live = input.globalLive && input.governanceEnabled && readiness.liveReady && profile.supportsLive;
    const allRequired = [...profile.requiredReadRoles, ...profile.requiredWriteRoles];
    const missing = (0, mapping_1.missingMappings)(mapping, allRequired).map((r) => r);
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
exports.assembleBatterySnapshot = assembleBatterySnapshot;
