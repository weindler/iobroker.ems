import type { EvccTelemetrySnapshot, EvccTelemetryReadHost } from "../evcc_telemetry";
import type { WallboxEvccTelemetryConfig } from "../evcc_config";
import type { StateHost } from "../../../ems_light/state_util";
import { resolveEvCapabilities } from "./capabilities";
import { evFoundationConfigFromAdapter, resolveEvPlanningHints } from "./config";
import { buildEvModelV1 } from "./model";
import { publishEvFoundationDiagnosis } from "./publish";
import { readExternalEvInformation, timezoneFromAdapterConfig } from "./external";
import { applyEvFoundationIntegration } from "./vehicle_model";

export * from "./types";
export * from "./catalog";
export * from "./write_allowlist";
export * from "./config";
export * from "./capabilities";
export * from "./model";
export * from "./external";
export * from "./vehicle_model";
export { WALLBOX_EV_FOUNDATION_STATES, ensureWallboxEvFoundationStates } from "./ensure_states";
export { publishEvFoundationDiagnosis } from "./publish";

export async function refreshEvFoundation(
	host: StateHost & { config?: unknown; getForeignStateAsync?: EvccTelemetryReadHost["getForeignStateAsync"] },
	snap: EvccTelemetrySnapshot,
	telemetryCfg: WallboxEvccTelemetryConfig,
): Promise<void> {
	const adapterConfig = host.config ?? {};
	const foundation = evFoundationConfigFromAdapter(adapterConfig);
	const hints = resolveEvPlanningHints(
		adapterConfig,
		snap.vehicle_name.status === "valid" ? snap.vehicle_name.value : null,
		snap.vehicle_title.status === "valid" ? snap.vehicle_title.value : null,
	);
	const now = new Date(snap.observed_at);
	const external = await readExternalEvInformation(host, foundation, {
		now: Number.isFinite(now.getTime()) ? now : new Date(),
		fallbackMaxAcKw: hints.maxAcChargePowerKw,
		configDepartureAt: foundation.departureAt,
		timezone: timezoneFromAdapterConfig(adapterConfig),
	});
	const capabilities = resolveEvCapabilities(telemetryCfg, snap, foundation, external);
	const built = buildEvModelV1({
		snap,
		foundation,
		capabilities,
		adapterConfig,
		external,
	});
	const model = applyEvFoundationIntegration(built, capabilities, adapterConfig);
	await publishEvFoundationDiagnosis(host, model, capabilities, snap.observed_at, external);
}
