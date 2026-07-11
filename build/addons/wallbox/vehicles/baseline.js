"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStoredBaseline = exports.setStoredBaseline = exports.clearStoredBaseline = exports.resetAllStoredBaselines = exports.hydrateProfileSocPersistenceFromLegacyStates = exports.parseLastTrustedSnapshotFromStateValues = exports.parseRollforwardAnchorFromStateValues = exports.updateProfileSocPersistenceAfterResolution = exports.resetAllProfileSocPersistence = exports.clearProfileSocPersistence = exports.setLastTrustedSnapshot = exports.setRollforwardAnchor = exports.getProfileSocPersistence = exports.getLastTrustedSnapshot = exports.getRollforwardAnchor = void 0;
const LAST_TRUSTED_SNAPSHOT_SOURCES = new Set([
    "direct",
    "energy_rollforward",
    "range_estimate",
]);
const rollforwardAnchorByVehicleId = new Map();
const lastTrustedByVehicleId = new Map();
function getRollforwardAnchor(vehicleId) {
    return rollforwardAnchorByVehicleId.get(vehicleId) ?? null;
}
exports.getRollforwardAnchor = getRollforwardAnchor;
function getLastTrustedSnapshot(vehicleId) {
    return lastTrustedByVehicleId.get(vehicleId) ?? null;
}
exports.getLastTrustedSnapshot = getLastTrustedSnapshot;
function getProfileSocPersistence(vehicleId) {
    return {
        vehicleId,
        rollforwardAnchor: getRollforwardAnchor(vehicleId),
        lastTrustedSnapshot: getLastTrustedSnapshot(vehicleId),
    };
}
exports.getProfileSocPersistence = getProfileSocPersistence;
function setRollforwardAnchor(anchor) {
    rollforwardAnchorByVehicleId.set(anchor.vehicleId, anchor);
}
exports.setRollforwardAnchor = setRollforwardAnchor;
function setLastTrustedSnapshot(snapshot) {
    lastTrustedByVehicleId.set(snapshot.vehicleId, snapshot);
}
exports.setLastTrustedSnapshot = setLastTrustedSnapshot;
function clearProfileSocPersistence(vehicleId) {
    rollforwardAnchorByVehicleId.delete(vehicleId);
    lastTrustedByVehicleId.delete(vehicleId);
}
exports.clearProfileSocPersistence = clearProfileSocPersistence;
function resetAllProfileSocPersistence() {
    rollforwardAnchorByVehicleId.clear();
    lastTrustedByVehicleId.clear();
}
exports.resetAllProfileSocPersistence = resetAllProfileSocPersistence;
function isLastTrustedSnapshotSource(source) {
    return LAST_TRUSTED_SNAPSHOT_SOURCES.has(source);
}
/** Apply post-resolution persistence rules — never upgrades rollforward anchor from estimates. */
function updateProfileSocPersistenceAfterResolution(vehicleId, resolution, sessionEnergyKwh, now) {
    if (resolution.resolvedSocPct === null)
        return;
    if (resolution.socSource === "direct") {
        setRollforwardAnchor({
            vehicleId,
            socPct: resolution.resolvedSocPct,
            observedAtMs: now.getTime(),
            sessionEnergyKwh,
            rootSource: "direct",
        });
        setLastTrustedSnapshot({
            vehicleId,
            socPct: resolution.resolvedSocPct,
            originalSource: "direct",
            quality: resolution.socQuality,
            observedAtMs: now.getTime(),
        });
        return;
    }
    if (resolution.socSource === "energy_rollforward" || resolution.socSource === "range_estimate") {
        if (isLastTrustedSnapshotSource(resolution.socSource)) {
            setLastTrustedSnapshot({
                vehicleId,
                socPct: resolution.resolvedSocPct,
                originalSource: resolution.socSource,
                quality: resolution.socQuality,
                observedAtMs: now.getTime(),
            });
        }
        return;
    }
    // last_trusted and unknown: do not update anchor or snapshot timestamps
}
exports.updateProfileSocPersistenceAfterResolution = updateProfileSocPersistenceAfterResolution;
function parseRollforwardAnchorFromStateValues(vehicleId, values) {
    const source = String(values.baselineSocSource ?? "").trim();
    if (source !== "direct")
        return null;
    const soc = typeof values.baselineSocPct === "number" && Number.isFinite(values.baselineSocPct)
        ? values.baselineSocPct
        : null;
    if (soc === null || soc < 0 || soc > 100)
        return null;
    const baselineAt = String(values.baselineAt ?? "").trim();
    const observedAtMs = Date.parse(baselineAt);
    if (!Number.isFinite(observedAtMs))
        return null;
    const sessionEnergyKwh = typeof values.sessionEnergyKwh === "number" && Number.isFinite(values.sessionEnergyKwh)
        ? values.sessionEnergyKwh
        : null;
    return {
        vehicleId,
        socPct: soc,
        observedAtMs,
        sessionEnergyKwh,
        rootSource: "direct",
    };
}
exports.parseRollforwardAnchorFromStateValues = parseRollforwardAnchorFromStateValues;
function parseLastTrustedSnapshotFromStateValues(vehicleId, values) {
    const soc = typeof values.lastTrustedSocPct === "number" && Number.isFinite(values.lastTrustedSocPct)
        ? values.lastTrustedSocPct
        : null;
    if (soc === null || soc < 0 || soc > 100)
        return null;
    const originalSource = String(values.lastTrustedOriginalSource ?? "").trim();
    if (!LAST_TRUSTED_SNAPSHOT_SOURCES.has(originalSource))
        return null;
    const observedAt = String(values.lastTrustedObservedAt ?? "").trim();
    const observedAtMs = Date.parse(observedAt);
    if (!Number.isFinite(observedAtMs))
        return null;
    const quality = originalSource === "direct" ? "high" : originalSource === "energy_rollforward" ? "medium" : "low";
    return {
        vehicleId,
        socPct: soc,
        originalSource,
        quality,
        observedAtMs,
    };
}
exports.parseLastTrustedSnapshotFromStateValues = parseLastTrustedSnapshotFromStateValues;
/** Legacy single-baseline parse — maps to persistence without creating invalid rollforward anchors. */
function hydrateProfileSocPersistenceFromLegacyStates(vehicleId, values) {
    if (!getRollforwardAnchor(vehicleId)) {
        const anchor = parseRollforwardAnchorFromStateValues(vehicleId, values);
        if (anchor)
            setRollforwardAnchor(anchor);
    }
    if (!getLastTrustedSnapshot(vehicleId)) {
        const snapshot = parseLastTrustedSnapshotFromStateValues(vehicleId, {
            lastTrustedSocPct: values.lastTrustedSocPct ?? values.baselineSocPct,
            lastTrustedOriginalSource: values.lastTrustedOriginalSource ?? values.baselineSocSource,
            lastTrustedObservedAt: values.lastTrustedObservedAt ?? values.baselineAt,
        });
        if (snapshot) {
            setLastTrustedSnapshot(snapshot);
        }
    }
}
exports.hydrateProfileSocPersistenceFromLegacyStates = hydrateProfileSocPersistenceFromLegacyStates;
// Backward-compatible aliases for tests transitioning from VehicleSocBaseline
function resetAllStoredBaselines() {
    resetAllProfileSocPersistence();
}
exports.resetAllStoredBaselines = resetAllStoredBaselines;
function clearStoredBaseline(vehicleId) {
    clearProfileSocPersistence(vehicleId);
}
exports.clearStoredBaseline = clearStoredBaseline;
function setStoredBaseline(legacy) {
    if (legacy.baselineSocSource === "direct") {
        const observedAtMs = Date.parse(legacy.baselineAt);
        if (Number.isFinite(observedAtMs)) {
            setRollforwardAnchor({
                vehicleId: legacy.vehicleId,
                socPct: legacy.baselineSocPct,
                observedAtMs,
                sessionEnergyKwh: legacy.sessionEnergyKwh,
                rootSource: "direct",
            });
        }
    }
    const source = legacy.baselineSocSource;
    if (LAST_TRUSTED_SNAPSHOT_SOURCES.has(source)) {
        const observedAtMs = Date.parse(legacy.baselineAt);
        if (Number.isFinite(observedAtMs)) {
            setLastTrustedSnapshot({
                vehicleId: legacy.vehicleId,
                socPct: legacy.baselineSocPct,
                originalSource: source,
                quality: source === "direct" ? "high" : source === "energy_rollforward" ? "medium" : "low",
                observedAtMs,
            });
        }
    }
}
exports.setStoredBaseline = setStoredBaseline;
function getStoredBaseline(vehicleId) {
    return getRollforwardAnchor(vehicleId);
}
exports.getStoredBaseline = getStoredBaseline;
