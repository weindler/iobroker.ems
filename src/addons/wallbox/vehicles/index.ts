/**
 * @deprecated Fat wallbox vehicle profiles (state trees under addons.wallbox.vehicles.*)
 * were removed in v0.1.227. Use `../vehicle_map` for optional EVCC-id → capacity/maxW.
 * Modules remain for transitional imports / cleanup helpers only — not called from runtime.
 */
export * from "./types";
export * from "./vehicle_id";
export * from "./config";
export * from "./normalize";
export * from "./readiness";
export * from "./resolve";
export * from "./soc";
export * from "./soc_energy";
export * from "./baseline";
export * from "./snapshot";
export * from "./charge_limits";
export * from "./ensure_states";
export * from "./runtime";
