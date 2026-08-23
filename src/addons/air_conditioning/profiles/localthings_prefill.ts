import { AC_UNIT_COUNT, acMappingFlatPrefix, type AcMappingRole, type AcProfileId } from "../constants";
import { isBootstrapComplete } from "../../../bootstrap/barrier";
import { isLocalthingsHassProfile } from "./registry";
import {
	deriveLocalthingsMappingsFromClimateBase,
	isHassLocalthingsTarget,
	isSmartThingsTarget,
	LOCALTHINGS_SITE_PRESETS,
} from "./localthings_presets";

function configRecord(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

function readTarget(c: Record<string, unknown>, unitIndex: number, role: AcMappingRole): string {
	const v = c[`${acMappingFlatPrefix(unitIndex, role)}_target`];
	return typeof v === "string" ? v.trim() : "";
}

function readProfile(c: Record<string, unknown>, unitIndex: number): string {
	const def = String(c.ac_default_profile ?? "samsung_smartthings").trim();
	const raw = c[`ac_u${unitIndex}_profile`];
	const s = typeof raw === "string" && raw.trim() ? raw.trim() : def;
	return s;
}

function unitHasHassMappings(c: Record<string, unknown>, unitIndex: number): boolean {
	const roles: AcMappingRole[] = [
		"feedback_switch",
		"cmd_switch_on",
		"cmd_set_mode",
		"cmd_set_cool_setpoint",
	];
	return roles.some((r) => isHassLocalthingsTarget(readTarget(c, unitIndex, r)));
}

function unitNeedsLocalthingsPrefill(c: Record<string, unknown>, unitIndex: number): boolean {
	if (!isLocalthingsHassProfile(readProfile(c, unitIndex))) return false;
	if (unitHasHassMappings(c, unitIndex)) return false;
	const on = readTarget(c, unitIndex, "cmd_switch_on");
	const fb = readTarget(c, unitIndex, "feedback_switch");
	if (!on && !fb) return true;
	// Noch SmartThings-Pfade nach Profilwechsel → Prefill erlaubt
	return isSmartThingsTarget(on) || isSmartThingsTarget(fb);
}

function applyMappingPatch(
	patch: Record<string, unknown>,
	unitIndex: number,
	mappings: Partial<Record<AcMappingRole, string>>,
	onlyEmptyOrSmartthings: boolean,
	c: Record<string, unknown>,
): void {
	for (const [role, target] of Object.entries(mappings) as Array<[AcMappingRole, string]>) {
		if (!target) continue;
		const key = `${acMappingFlatPrefix(unitIndex, role)}_target`;
		const enKey = `${acMappingFlatPrefix(unitIndex, role)}_enabled`;
		const existing = readTarget(c, unitIndex, role);
		if (onlyEmptyOrSmartthings) {
			if (existing && isHassLocalthingsTarget(existing)) continue;
			if (existing && !isSmartThingsTarget(existing) && existing.length > 0) continue;
		}
		patch[key] = target;
		patch[enKey] = true;
	}
}

/**
 * Prefill für LocalThings: nur wenn Profil LocalThings und keine HASS-Mappings.
 * Überschreibt keine vorhandenen hass.* User-Mappings.
 * Site-Presets für bekannte Units; sonst Ableitung aus Climate-Basis falls gesetzt.
 */
export function buildLocalthingsPrefillPatch(config: unknown): Record<string, unknown> | null {
	const c = configRecord(config);
	const patch: Record<string, unknown> = {};

	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		if (!unitNeedsLocalthingsPrefill(c, i)) continue;

		const preset = LOCALTHINGS_SITE_PRESETS.find((p) => p.unitIndex === i);
		if (preset) {
			applyMappingPatch(patch, i, preset.mappings, true, c);
			continue;
		}

		const climateHint =
			readTarget(c, i, "feedback_mode") ||
			readTarget(c, i, "feedback_switch") ||
			readTarget(c, i, "cmd_switch_on");
		const derived = deriveLocalthingsMappingsFromClimateBase(climateHint);
		if (Object.keys(derived).length > 0) {
			applyMappingPatch(patch, i, derived, true, c);
		}
	}

	return Object.keys(patch).length > 0 ? patch : null;
}

export function mergeLocalthingsPrefillIntoConfig(config: unknown): Record<string, unknown> {
	const c = { ...configRecord(config) };
	const patch = buildLocalthingsPrefillPatch(c);
	if (!patch) return c;
	return { ...c, ...patch };
}

export type PrefillPersistHost = {
	log: { info: (msg: string) => void; warn: (msg: string) => void };
	updateConfig?: (newConfig: Record<string, unknown>) => Promise<unknown>;
};

let prefillPersistTimer: ReturnType<typeof setTimeout> | null = null;

/** Tests / Stop: ausstehenden Prefill-Persist abbrechen. */
export function clearLocalthingsPrefillPersistTimer(): void {
	if (prefillPersistTimer) {
		clearTimeout(prefillPersistTimer);
		prefillPersistTimer = null;
	}
}

/**
 * updateConfig erst NACH Bootstrap — sonst stirbt die Instanz mitten in ems-light runtime
 * (Redis „DB closed“, Host null).
 */
export function scheduleLocalthingsPrefillPersist(
	host: PrefillPersistHost,
	mergedConfig: Record<string, unknown>,
): void {
	if (typeof host.updateConfig !== "function") return;
	clearLocalthingsPrefillPersistTimer();
	const attempt = (): void => {
		prefillPersistTimer = null;
		if (!isBootstrapComplete()) {
			prefillPersistTimer = setTimeout(attempt, 1_000);
			return;
		}
		void host
			.updateConfig!(mergedConfig)
			.then(() => {
				host.log.info(
					"air_conditioning: LocalThings Prefill in Admin-Config gespeichert (Instanz startet neu)",
				);
			})
			.catch((e) => {
				host.log.warn(
					`air_conditioning: LocalThings Prefill speichern fehlgeschlagen: ${e instanceof Error ? e.message : e}`,
				);
			});
	};
	// Kurze Pause nach Bootstrap-Ende, damit post-bootstrap fertig werden kann.
	prefillPersistTimer = setTimeout(attempt, 2_000);
}

export type PrefillProfileId = AcProfileId;
