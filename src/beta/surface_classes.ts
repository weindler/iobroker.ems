/**
 * Beta Product Surface Classification — keine Migration, nur klarer Produktfokus.
 * Mapping auf bestehende Audit-Familien (src/audit/state_surface_catalog.ts).
 */

export type SurfaceClass = "PRODUCT" | "ADVANCED" | "SUPPORT_ONLY" | "INTERNAL" | "DEPRECATED";

export type SurfaceClassEntry = {
	familyId: string;
	surfaceClass: SurfaceClass;
	/** Kurz: warum / für wen sichtbar. */
	noteDe: string;
};

/** Klassifikation der bekannten State-Familien für Beta UI. */
export const BETA_SURFACE_CLASSES: readonly SurfaceClassEntry[] = [
	{
		familyId: "global_execution",
		surfaceClass: "PRODUCT",
		noteDe: "Global Dryrun/Live — oberste Ausführungs-Wahrheit.",
	},
	{
		familyId: "global_modes",
		surfaceClass: "PRODUCT",
		noteDe: "Strategie eco/balanced/comfort/forced.",
	},
	{
		familyId: "operator",
		surfaceClass: "PRODUCT",
		noteDe: "Briefing, Product Summary, Notifications, Live-Diagnose kompakt.",
	},
	{
		familyId: "live_telemetry",
		surfaceClass: "PRODUCT",
		noteDe: "SOC, PV, Last, Puffer, Fahrzeug-SOC — Alltagswerte.",
	},
	{
		familyId: "execution_safety",
		surfaceClass: "PRODUCT",
		noteDe: "Effektive Ausführungszusammenfassung.",
	},
	{
		familyId: "battery_runtime",
		surfaceClass: "PRODUCT",
		noteDe: "Status/Aktion/Limits — ohne Shadow/Authority/Lease.",
	},
	{
		familyId: "immersion_heater_runtime",
		surfaceClass: "PRODUCT",
		noteDe: "Temperatur, Ziel, Aktion, Fenster.",
	},
	{
		familyId: "air_conditioning_runtime",
		surfaceClass: "PRODUCT",
		noteDe: "Raumtemperatur, Komfort, Aktion.",
	},
	{
		familyId: "wallbox_runtime",
		surfaceClass: "PRODUCT",
		noteDe: "EVCC-Spiegel: verbunden, Laden, Goal — ohne interne Planner-Gates.",
	},
	{
		familyId: "daily_plan_allocation",
		surfaceClass: "ADVANCED",
		noteDe: "Allocation JSON — für Experten/VIS optional.",
	},
	{
		familyId: "learning",
		surfaceClass: "ADVANCED",
		noteDe: "Learning-Status und Persistenz — nicht Alltag.",
	},
	{
		familyId: "ai",
		surfaceClass: "ADVANCED",
		noteDe: "KI Advisory/Explanation — keine Plan-Authority.",
	},
	{
		familyId: "compare",
		surfaceClass: "ADVANCED",
		noteDe: "Plan A/B Vergleich advisory.",
	},
	{
		familyId: "policy",
		surfaceClass: "ADVANCED",
		noteDe: "Policy-Grenzen.",
	},
	{
		familyId: "economics",
		surfaceClass: "ADVANCED",
		noteDe: "Tarif-/Kostenfelder.",
	},
	{
		familyId: "backup_restore",
		surfaceClass: "SUPPORT_ONLY",
		noteDe: "Backup/Restore/Support.",
	},
	{
		familyId: "audit_diagnostics",
		surfaceClass: "SUPPORT_ONLY",
		noteDe: "Diagnosebäume nur bei VIS-Diagnose-Haken.",
	},
	{
		familyId: "planner_shadow_takeover",
		surfaceClass: "DEPRECATED",
		noteDe: "Shadow/Takeover/Lease — nicht Produktoberfläche; Cleanup erlaubt.",
	},
	{
		familyId: "legacy_planner_intent",
		surfaceClass: "DEPRECATED",
		noteDe: "Alte planner.intent.thermal/cooling — nicht neu beleben.",
	},
	{
		familyId: "internal_gates",
		surfaceClass: "INTERNAL",
		noteDe: "Candidate-/Gate-/Fingerprint-States — technisch, nicht UI.",
	},
] as const;

export function countBySurfaceClass(): Record<SurfaceClass, number> {
	const out: Record<SurfaceClass, number> = {
		PRODUCT: 0,
		ADVANCED: 0,
		SUPPORT_ONLY: 0,
		INTERNAL: 0,
		DEPRECATED: 0,
	};
	for (const e of BETA_SURFACE_CLASSES) out[e.surfaceClass] += 1;
	return out;
}
