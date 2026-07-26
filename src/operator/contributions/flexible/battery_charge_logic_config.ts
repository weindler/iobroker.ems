import { batteryConfigFromAdapter } from "../../../addons/battery/config";
import type { BatteryChargeLogicConfig } from "./battery_charge_logic";

/**
 * Liest die Admin-Config für die PV-Defizit-Ladelogik.
 *
 * Nutzt bewusst dieselben nativen Config-Keys (`bat_winter_plan_*`) wie die auslaufende
 * Legacy-Planner-Regel (`planner/battery_winter_config.ts`) — ein Rename der Keys würde
 * bestehende Nutzer-Einstellungen beim Update verlieren (kein Migrationsschritt vorhanden).
 * Nur die Bezeichnung nach außen (Label, reason_de, Doku) ist "Batterie-Lade-Logik",
 * siehe `docs/EMS_LIGHT_ROADMAP.md` Block 2.
 */

function rec(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

function num(c: Record<string, unknown>, key: string): number | null {
	const v = c[key];
	if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
	const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
	return Number.isFinite(n) ? n : null;
}

function intIn(c: Record<string, unknown>, key: string, def: number, min: number, max: number): number {
	const n = num(c, key);
	if (n === null) return def;
	return Math.min(max, Math.max(min, Math.round(n)));
}

function floatIn(c: Record<string, unknown>, key: string, def: number, min: number, max: number): number {
	const n = num(c, key);
	if (n === null) return def;
	return Math.min(max, Math.max(min, n));
}

function bool(c: Record<string, unknown>, key: string, def: boolean): boolean {
	const v = c[key];
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	if (typeof v === "string") {
		const s = v.trim().toLowerCase();
		if (["1", "true", "on", "yes", "ja"].includes(s)) return true;
		if (["0", "false", "off", "no", "nein"].includes(s)) return false;
	}
	return def;
}

export function batteryChargeLogicConfigFromAdapter(config: unknown): BatteryChargeLogicConfig {
	const c = rec(config);
	const battery = batteryConfigFromAdapter(config);
	return {
		enabled: bool(c, "bat_winter_plan_enabled", true),
		horizonDays: intIn(c, "bat_winter_plan_horizon_days", 7, 1, 14),
		marginKwh: floatIn(c, "bat_winter_plan_margin_kwh", 0.5, 0, 50),
		pvRecoveryRatio: floatIn(c, "bat_winter_pv_recovery_ratio", 1.15, 1, 3),
		reserveLowConfidenceFactor: floatIn(c, "bat_winter_reserve_low_confidence_factor", 0.25, 0, 2),
		maxSocPct: battery.limits.maxSocPct ?? 100,
		minSocPct: battery.limits.minSocPct ?? 0,
		capacityKwh: battery.capacityManualKwh,
	};
}
