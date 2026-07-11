import type {
	LastTrustedOriginalSource,
	ResolvedVehicleSocQuality,
	ResolvedVehicleSocSource,
	VehicleLastTrustedSnapshot,
	VehicleProfileSocPersistence,
	VehicleRollforwardAnchor,
	VehicleSocEnergyResolution,
} from "./types";

const LAST_TRUSTED_SNAPSHOT_SOURCES: ReadonlySet<LastTrustedOriginalSource> = new Set([
	"direct",
	"energy_rollforward",
	"range_estimate",
]);

const rollforwardAnchorByVehicleId = new Map<string, VehicleRollforwardAnchor>();
const lastTrustedByVehicleId = new Map<string, VehicleLastTrustedSnapshot>();

export function getRollforwardAnchor(vehicleId: string): VehicleRollforwardAnchor | null {
	return rollforwardAnchorByVehicleId.get(vehicleId) ?? null;
}

export function getLastTrustedSnapshot(vehicleId: string): VehicleLastTrustedSnapshot | null {
	return lastTrustedByVehicleId.get(vehicleId) ?? null;
}

export function getProfileSocPersistence(vehicleId: string): VehicleProfileSocPersistence {
	return {
		vehicleId,
		rollforwardAnchor: getRollforwardAnchor(vehicleId),
		lastTrustedSnapshot: getLastTrustedSnapshot(vehicleId),
	};
}

export function setRollforwardAnchor(anchor: VehicleRollforwardAnchor): void {
	rollforwardAnchorByVehicleId.set(anchor.vehicleId, anchor);
}

export function setLastTrustedSnapshot(snapshot: VehicleLastTrustedSnapshot): void {
	lastTrustedByVehicleId.set(snapshot.vehicleId, snapshot);
}

export function clearProfileSocPersistence(vehicleId: string): void {
	rollforwardAnchorByVehicleId.delete(vehicleId);
	lastTrustedByVehicleId.delete(vehicleId);
}

export function resetAllProfileSocPersistence(): void {
	rollforwardAnchorByVehicleId.clear();
	lastTrustedByVehicleId.clear();
}

function isLastTrustedSnapshotSource(
	source: ResolvedVehicleSocSource,
): source is LastTrustedOriginalSource {
	return LAST_TRUSTED_SNAPSHOT_SOURCES.has(source as LastTrustedOriginalSource);
}

/** Apply post-resolution persistence rules — never upgrades rollforward anchor from estimates. */
export function updateProfileSocPersistenceAfterResolution(
	vehicleId: string,
	resolution: VehicleSocEnergyResolution,
	sessionEnergyKwh: number | null,
	now: Date,
): void {
	if (resolution.resolvedSocPct === null) return;

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

export function parseRollforwardAnchorFromStateValues(
	vehicleId: string,
	values: {
		baselineSocPct: unknown;
		baselineSocSource: unknown;
		baselineAt: unknown;
		sessionEnergyKwh: unknown;
	},
): VehicleRollforwardAnchor | null {
	const source = String(values.baselineSocSource ?? "").trim();
	if (source !== "direct") return null;
	const soc =
		typeof values.baselineSocPct === "number" && Number.isFinite(values.baselineSocPct)
			? values.baselineSocPct
			: null;
	if (soc === null || soc < 0 || soc > 100) return null;
	const baselineAt = String(values.baselineAt ?? "").trim();
	const observedAtMs = Date.parse(baselineAt);
	if (!Number.isFinite(observedAtMs)) return null;
	const sessionEnergyKwh =
		typeof values.sessionEnergyKwh === "number" && Number.isFinite(values.sessionEnergyKwh)
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

export function parseLastTrustedSnapshotFromStateValues(
	vehicleId: string,
	values: {
		lastTrustedSocPct: unknown;
		lastTrustedOriginalSource: unknown;
		lastTrustedObservedAt: unknown;
	},
): VehicleLastTrustedSnapshot | null {
	const soc =
		typeof values.lastTrustedSocPct === "number" && Number.isFinite(values.lastTrustedSocPct)
			? values.lastTrustedSocPct
			: null;
	if (soc === null || soc < 0 || soc > 100) return null;
	const originalSource = String(values.lastTrustedOriginalSource ?? "").trim() as LastTrustedOriginalSource;
	if (!LAST_TRUSTED_SNAPSHOT_SOURCES.has(originalSource)) return null;
	const observedAt = String(values.lastTrustedObservedAt ?? "").trim();
	const observedAtMs = Date.parse(observedAt);
	if (!Number.isFinite(observedAtMs)) return null;
	const quality: ResolvedVehicleSocQuality =
		originalSource === "direct" ? "high" : originalSource === "energy_rollforward" ? "medium" : "low";
	return {
		vehicleId,
		socPct: soc,
		originalSource,
		quality,
		observedAtMs,
	};
}

/** Legacy single-baseline parse — maps to persistence without creating invalid rollforward anchors. */
export function hydrateProfileSocPersistenceFromLegacyStates(
	vehicleId: string,
	values: {
		baselineSocPct: unknown;
		baselineSocSource: unknown;
		baselineAt: unknown;
		sessionEnergyKwh: unknown;
		lastTrustedSocPct?: unknown;
		lastTrustedOriginalSource?: unknown;
		lastTrustedObservedAt?: unknown;
	},
): void {
	if (!getRollforwardAnchor(vehicleId)) {
		const anchor = parseRollforwardAnchorFromStateValues(vehicleId, values);
		if (anchor) setRollforwardAnchor(anchor);
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

// Backward-compatible aliases for tests transitioning from VehicleSocBaseline
export function resetAllStoredBaselines(): void {
	resetAllProfileSocPersistence();
}

export function clearStoredBaseline(vehicleId: string): void {
	clearProfileSocPersistence(vehicleId);
}

export function setStoredBaseline(legacy: {
	vehicleId: string;
	baselineSocPct: number;
	baselineSocSource: string;
	baselineAt: string;
	sessionEnergyKwh: number | null;
}): void {
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
	const source = legacy.baselineSocSource as LastTrustedOriginalSource;
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

export function getStoredBaseline(vehicleId: string): VehicleRollforwardAnchor | null {
	return getRollforwardAnchor(vehicleId);
}
