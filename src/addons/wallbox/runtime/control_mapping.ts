import {
	legacyWallboxMappingFromConfig,
	WALLBOX_FLAT_PREFIX,
	type WallboxMappingCommand,
} from "../../../mapping_config";
import type { WallboxEvccTelemetryConfig } from "../evcc_config";

/** Legacy go-e Write-Rollen aus mapping_config (keine erfundenen Rollen). */
export type WallboxWriteControlRole = Extract<
	WallboxMappingCommand,
	"set_enabled" | "set_current_a" | "set_charge_power_w"
>;

/** Klassifikation des konfigurierten Ziel-States (heuristisch aus State-ID, ohne IO). */
export type WallboxControlTargetKind = "evcc" | "goe_direct" | "user_configured";

export interface WallboxControlMappingEntry {
	role: WallboxWriteControlRole;
	configured: boolean;
	targetStateId: string;
	targetValueType: "boolean" | "number";
	targetKind: WallboxControlTargetKind;
	allowedValuesRaw: string | null;
	readbackStateId: string | null;
	required: boolean;
}

export interface WallboxControlMappingSnapshot {
	/**
	 * Name aus mapping_config / Admin-Vorlage — bedeutet „Legacy wb_set_*-Mappings“,
	 * nicht zwingend EVCC-Steuerung. Zielstates können direkt go-e oder frei konfiguriert sein.
	 */
	controlModel: "legacy_goe";
	setEnabled: WallboxControlMappingEntry | null;
	setCurrentA: WallboxControlMappingEntry | null;
	setChargePowerW: WallboxControlMappingEntry | null;
	chargeControlRole: "set_current_a" | "set_charge_power_w" | null;
	missingRoles: string[];
	/** Strom- und Leistungsrolle zeigen auf denselben State — Einheit nicht eindeutig. */
	ambiguousPowerControl: boolean;
	mappingConflictReason: string | null;
	/** true nur wenn alle Pflicht-Write-Targets als evcc.* klassifiziert sind. */
	evccControlPathConfirmed: boolean;
}

function mappingEnabled(config: Record<string, unknown>, prefix: string): boolean {
	return config[`${prefix}_enabled`] !== false;
}

function flatTarget(config: Record<string, unknown>, prefix: string): string {
	const t = config[`${prefix}_target`];
	return typeof t === "string" ? t.trim() : "";
}

/** Heuristik: evcc.* = EVCC-State, go-e.* = direkter go-eCharger-Pfad, sonst frei konfiguriert. */
export function classifyWallboxControlTargetKind(stateId: string): WallboxControlTargetKind {
	const id = stateId.trim().toLowerCase();
	if (id.startsWith("evcc.")) return "evcc";
	if (id.startsWith("go-e.")) return "goe_direct";
	return "user_configured";
}

function entryFromConfig(
	role: WallboxWriteControlRole,
	config: Record<string, unknown>,
	legacy: ReturnType<typeof legacyWallboxMappingFromConfig>,
	readbackStateId: string | null,
	required: boolean,
): WallboxControlMappingEntry | null {
	const prefix = WALLBOX_FLAT_PREFIX[role];
	const enabled = mappingEnabled(config, prefix);
	const targetStateId = legacy[role]?.target_state?.trim() || flatTarget(config, prefix);
	if (!enabled || !targetStateId) {
		return null;
	}
	const valueType: "boolean" | "number" = role === "set_enabled" ? "boolean" : "number";
	return {
		role,
		configured: true,
		targetStateId,
		targetValueType: valueType,
		targetKind: classifyWallboxControlTargetKind(targetStateId),
		allowedValuesRaw:
			typeof legacy[role]?.allowed_values === "string" ? legacy[role]!.allowed_values! : null,
		readbackStateId:
			typeof readbackStateId === "string" && readbackStateId.trim().length > 0
				? readbackStateId.trim()
				: null,
		required,
	};
}

function resolveChargeControlRole(
	setCurrentA: WallboxControlMappingEntry | null,
	setChargePowerW: WallboxControlMappingEntry | null,
): {
	chargeControlRole: "set_current_a" | "set_charge_power_w" | null;
	ambiguousPowerControl: boolean;
	mappingConflictReason: string | null;
} {
	if (setCurrentA && setChargePowerW) {
		if (setCurrentA.targetStateId === setChargePowerW.targetStateId) {
			return {
				chargeControlRole: null,
				ambiguousPowerControl: true,
				mappingConflictReason: "ambiguous_power_control_mapping",
			};
		}
		return {
			chargeControlRole: "set_current_a",
			ambiguousPowerControl: false,
			mappingConflictReason: null,
		};
	}
	if (setCurrentA) {
		return {
			chargeControlRole: "set_current_a",
			ambiguousPowerControl: false,
			mappingConflictReason: null,
		};
	}
	if (setChargePowerW) {
		return {
			chargeControlRole: "set_charge_power_w",
			ambiguousPowerControl: false,
			mappingConflictReason: null,
		};
	}
	return {
		chargeControlRole: null,
		ambiguousPowerControl: false,
		mappingConflictReason: null,
	};
}

function computeEvccControlPathConfirmed(
	setEnabled: WallboxControlMappingEntry | null,
	chargeEntry: WallboxControlMappingEntry | null,
): boolean {
	if (!setEnabled || !chargeEntry) return false;
	return setEnabled.targetKind === "evcc" && chargeEntry.targetKind === "evcc";
}

export interface BuildWallboxControlMappingSnapshotInput {
	config: Record<string, unknown>;
	telemetryCfg: Pick<WallboxEvccTelemetryConfig, "enabledStateId" | "chargePowerWStateId">;
}

/**
 * Normalisierter Control-Mapping-Snapshot aus Admin-Config und Telemetrie-IDs (read-only).
 * Keine ioBroker-Objektauflösung — rein aus Konfiguration.
 */
export function buildWallboxControlMappingSnapshot(
	input: BuildWallboxControlMappingSnapshotInput,
): WallboxControlMappingSnapshot {
	const { config, telemetryCfg } = input;
	const legacy = legacyWallboxMappingFromConfig(config);

	const setEnabled = entryFromConfig(
		"set_enabled",
		config,
		legacy,
		telemetryCfg.enabledStateId,
		true,
	);
	const setCurrentA = entryFromConfig(
		"set_current_a",
		config,
		legacy,
		"",
		false,
	);
	const setChargePowerW = entryFromConfig(
		"set_charge_power_w",
		config,
		legacy,
		telemetryCfg.chargePowerWStateId,
		false,
	);

	const missingRoles: string[] = [];
	if (!setEnabled) missingRoles.push("set_enabled");

	const roleResolution = resolveChargeControlRole(setCurrentA, setChargePowerW);
	if (!roleResolution.chargeControlRole && !roleResolution.ambiguousPowerControl) {
		missingRoles.push("set_current_a|set_charge_power_w");
	}

	const chargeEntry =
		roleResolution.chargeControlRole === "set_current_a"
			? setCurrentA
			: roleResolution.chargeControlRole === "set_charge_power_w"
				? setChargePowerW
				: null;

	return {
		controlModel: "legacy_goe",
		setEnabled,
		setCurrentA,
		setChargePowerW,
		chargeControlRole: roleResolution.chargeControlRole,
		missingRoles,
		ambiguousPowerControl: roleResolution.ambiguousPowerControl,
		mappingConflictReason: roleResolution.mappingConflictReason,
		evccControlPathConfirmed: computeEvccControlPathConfirmed(setEnabled, chargeEntry),
	};
}
