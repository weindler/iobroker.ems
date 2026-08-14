import {
	legacyWallboxMappingFromConfig,
	WALLBOX_FLAT_PREFIX,
	type WallboxMappingCommand,
} from "../../../mapping_config";
import type { WallboxEvccTelemetryConfig } from "../evcc_config";
import {
	collectConfiguredControlTargetStateIds,
	evccControlTargetForRole,
	evccModeChargeValue,
	evccModeHoldValue,
	hasEvccControlWriteMapping,
	resolveWallboxControlModel,
	type EvccControlContractModel,
	type WallboxControlModel,
	type WallboxEvccControlRole,
} from "../evcc_control_config";
import {
	controlContractModelFromVariant,
	pickEvccButtonStateId,
	resolveEvccModeControlContract,
	type EvccModeButton,
	type EvccModeControlVariant,
} from "../evcc_mode_control";
import { hasLegacyWallboxWriteMapping } from "../evcc_config";
import {
	classifyWallboxControlTargetKind,
	inferEvccSemanticRole,
	validateControlObjectMeta,
	validateEnumValueAgainstMeta,
	validateEvccButtonTargetMeta,
	validateEvccControlTargetMeta,
	type WallboxControlObjectMeta,
	type WallboxControlObjectMetaMap,
	type WallboxControlTargetKind,
	type WallboxEvccSemanticRole,
} from "./control_object_meta";

export type WallboxWriteControlRole = Extract<
	WallboxMappingCommand,
	"set_enabled" | "set_current_a" | "set_charge_power_w"
>;

export type WallboxEvccWriteRole = WallboxEvccControlRole;

export interface WallboxControlMappingEntry {
	role: WallboxWriteControlRole | WallboxEvccWriteRole;
	configured: boolean;
	targetStateId: string;
	targetValueType: "boolean" | "number" | "string";
	targetKind: WallboxControlTargetKind;
	semanticRole: WallboxEvccSemanticRole | "legacy_enabled" | "legacy_current" | "legacy_power" | null;
	allowedValuesRaw: string | null;
	readbackStateId: string | null;
	required: boolean;
	objectPresent: boolean;
	writable: boolean;
	commonType: string | null;
	contractValid: boolean;
	validationReason: string | null;
}

export interface WallboxControlMappingSnapshot {
	controlModel: WallboxControlModel;
	legacyMappingsPresent: boolean;
	evccMappingsPresent: boolean;
	setEnabled: WallboxControlMappingEntry | null;
	setCurrentA: WallboxControlMappingEntry | null;
	setChargePowerW: WallboxControlMappingEntry | null;
	setMode: WallboxControlMappingEntry | null;
	setMaxCurrentA: WallboxControlMappingEntry | null;
	setPhase: WallboxControlMappingEntry | null;
	evccChargeModeValue: string | null;
	evccHoldModeValue: string | null;
	chargeModeValueConfirmed: boolean;
	holdModeValueConfirmed: boolean;
	chargeControlRole: "set_current_a" | "set_charge_power_w" | null;
	missingRoles: string[];
	ambiguousPowerControl: boolean;
	mappingConflictReason: string | null;
	evccControlPathConfirmed: boolean;
	liveEligible: boolean;
	controlPathReason: string | null;
	validationIssues: string[];
	controlContractModel: EvccControlContractModel;
	evccControlContractReady: boolean;
	legacyDirectControlPresent: boolean;
	evccModeControlVariant: EvccModeControlVariant;
	evccModeFeedbackStateId: string;
	evccModeButtonsReady: boolean;
	evccModeButtonReady: Record<EvccModeButton, boolean>;
	activeContractInputs: Record<string, unknown>;
	ignoredLegacyConfig: Record<string, unknown>;
}

export { classifyWallboxControlTargetKind } from "./control_object_meta";
export type { WallboxControlTargetKind, WallboxEvccSemanticRole } from "./control_object_meta";

export type WallboxControlTelemetryCfg = Pick<
	WallboxEvccTelemetryConfig,
	"maxCurrentAStateId" | "enabledStateId"
> & {
	modeReadbackStateId: string;
};

function mappingEnabled(config: Record<string, unknown>, prefix: string): boolean {
	return config[`${prefix}_enabled`] !== false;
}

function flatTarget(config: Record<string, unknown>, prefix: string): string {
	const t = config[`${prefix}_target`];
	return typeof t === "string" ? t.trim() : "";
}

function legacySemanticRole(
	role: WallboxWriteControlRole,
): "legacy_enabled" | "legacy_current" | "legacy_power" {
	if (role === "set_enabled") return "legacy_enabled";
	if (role === "set_current_a") return "legacy_current";
	return "legacy_power";
}

function applyMetaValidation(
	entry: Omit<
		WallboxControlMappingEntry,
		"objectPresent" | "writable" | "commonType" | "contractValid" | "validationReason" | "semanticRole"
	>,
	meta: WallboxControlObjectMeta | undefined,
	evccPath: boolean,
	evccRole?: WallboxEvccControlRole,
): WallboxControlMappingEntry {
	let contractValid = true;
	let validationReason: string | null = null;
	let semanticRole: WallboxControlMappingEntry["semanticRole"] = inferEvccSemanticRole(entry.targetStateId);

	if (evccPath && evccRole) {
		const v = validateEvccControlTargetMeta(entry.targetStateId, entry.targetValueType, meta, evccRole);
		contractValid = v.valid;
		validationReason = v.reason;
		semanticRole = v.semanticRole;
	} else if (meta) {
		const v = validateControlObjectMeta(meta, entry.targetValueType);
		contractValid = v.valid;
		validationReason = v.reason;
	} else {
		contractValid = false;
		validationReason = "object_metadata_unverified";
	}

	return {
		...entry,
		semanticRole,
		objectPresent: meta?.objectPresent ?? false,
		writable: meta?.writable ?? false,
		commonType: meta?.commonType ?? null,
		contractValid,
		validationReason,
	};
}

function legacyEntryFromConfig(
	role: WallboxWriteControlRole,
	config: Record<string, unknown>,
	legacy: ReturnType<typeof legacyWallboxMappingFromConfig>,
	readbackStateId: string | null,
	required: boolean,
	meta: WallboxControlObjectMeta | undefined,
): WallboxControlMappingEntry | null {
	const prefix = WALLBOX_FLAT_PREFIX[role];
	const enabled = mappingEnabled(config, prefix);
	const targetStateId = legacy[role]?.target_state?.trim() || flatTarget(config, prefix);
	if (!enabled || !targetStateId) return null;
	const valueType: "boolean" | "number" = role === "set_enabled" ? "boolean" : "number";
	const entry = applyMetaValidation(
		{
			role,
			configured: true,
			targetStateId,
			targetValueType: valueType,
			targetKind: classifyWallboxControlTargetKind(targetStateId),
			allowedValuesRaw:
				typeof legacy[role]?.allowed_values === "string" ? legacy[role]!.allowed_values! : null,
			readbackStateId: readbackStateId?.trim() || null,
			required,
		},
		meta,
		false,
	);
	return { ...entry, semanticRole: legacySemanticRole(role) };
}

function evccEntryFromConfig(
	role: WallboxEvccControlRole,
	config: Record<string, unknown>,
	readbackStateId: string | null,
	required: boolean,
	meta: WallboxControlObjectMeta | undefined,
): WallboxControlMappingEntry | null {
	const targetStateId = evccControlTargetForRole(config, role);
	if (!targetStateId) return null;
	return applyMetaValidation(
		{
			role,
			configured: true,
			targetStateId,
			targetValueType: role === "set_mode" ? "string" : "number",
			targetKind: classifyWallboxControlTargetKind(targetStateId),
			allowedValuesRaw: null,
			readbackStateId: readbackStateId?.trim() || null,
			required,
		},
		meta,
		true,
		role,
	);
}

function resolveChargeControlRole(
	setCurrentA: WallboxControlMappingEntry | null,
	setChargePowerW: WallboxControlMappingEntry | null,
) {
	if (setCurrentA && setChargePowerW && setCurrentA.targetStateId === setChargePowerW.targetStateId) {
		return { chargeControlRole: null, ambiguousPowerControl: true, mappingConflictReason: "ambiguous_power_control_mapping" as const };
	}
	if (setCurrentA && setChargePowerW) return { chargeControlRole: "set_current_a" as const, ambiguousPowerControl: false, mappingConflictReason: null };
	if (setCurrentA) return { chargeControlRole: "set_current_a" as const, ambiguousPowerControl: false, mappingConflictReason: null };
	if (setChargePowerW) return { chargeControlRole: "set_charge_power_w" as const, ambiguousPowerControl: false, mappingConflictReason: null };
	return { chargeControlRole: null, ambiguousPowerControl: false, mappingConflictReason: null };
}

function collectValidationIssues(entries: (WallboxControlMappingEntry | null)[]): string[] {
	const issues: string[] = [];
	for (const e of entries) {
		if (e?.required && !e.contractValid && e.validationReason) issues.push(`${e.role}:${e.validationReason}`);
	}
	return issues;
}

function contractDiagnosis(config: Record<string, unknown>, controlModel: WallboxControlModel) {
	const contract = resolveEvccModeControlContract(config);
	return {
		controlContractModel: controlContractModelFromVariant(controlModel, contract.resolvedVariant),
		evccControlContractReady: controlModel === "evcc" && contract.writeContractReady,
		legacyDirectControlPresent: hasLegacyWallboxWriteMapping(config),
		evccModeControlVariant: controlModel === "evcc" ? contract.resolvedVariant : ("none" as const),
		evccModeFeedbackStateId: contract.modeFeedbackStateId,
		evccModeButtonsReady: controlModel === "evcc" && contract.buttonsReady,
		evccModeButtonReady: contract.buttonReady,
		activeContractInputs: (contract.detail.activeInputs as Record<string, unknown>) ?? {},
		ignoredLegacyConfig: (contract.detail.ignoredLegacyConfig as Record<string, unknown>) ?? {},
	};
}

function emptyEvccFields() {
	return {
		setMode: null,
		setMaxCurrentA: null,
		setPhase: null,
		evccChargeModeValue: null,
		evccHoldModeValue: null,
		chargeModeValueConfirmed: false,
		holdModeValueConfirmed: false,
	};
}

function buildNoneSnapshot(config: Record<string, unknown>): WallboxControlMappingSnapshot {
	return {
		controlModel: "none",
		legacyMappingsPresent: hasLegacyWallboxWriteMapping(config),
		evccMappingsPresent: hasEvccControlWriteMapping(config),
		setEnabled: null,
		setCurrentA: null,
		setChargePowerW: null,
		...emptyEvccFields(),
		chargeControlRole: null,
		missingRoles: ["control_model_not_selected"],
		ambiguousPowerControl: false,
		mappingConflictReason: null,
		evccControlPathConfirmed: false,
		liveEligible: false,
		controlPathReason: "control_model_not_selected",
		validationIssues: [],
		...contractDiagnosis(config, "none"),
	};
}

function evccEntryFromStateId(
	role: WallboxEvccControlRole,
	targetStateId: string,
	readbackStateId: string | null,
	required: boolean,
	meta: WallboxControlObjectMeta | undefined,
): WallboxControlMappingEntry | null {
	if (!targetStateId) return null;
	return applyMetaValidation(
		{
			role,
			configured: true,
			targetStateId,
			targetValueType: role === "set_mode" ? "string" : "number",
			targetKind: classifyWallboxControlTargetKind(targetStateId),
			allowedValuesRaw: null,
			readbackStateId: readbackStateId?.trim() || null,
			required,
		},
		meta,
		true,
		role,
	);
}

function buttonValidationIssues(
	config: Record<string, unknown>,
	objectMetas: WallboxControlObjectMetaMap,
): string[] {
	const issues: string[] = [];
	for (const button of ["off", "pv", "min", "now"] as const) {
		const id = pickEvccButtonStateId(config, button);
		if (!id) continue;
		const v = validateEvccButtonTargetMeta(id, button, objectMetas[id]);
		if (!v.valid && v.reason) issues.push(`control.${button}:${v.reason}`);
	}
	return issues;
}

function buildEvccSnapshot(
	config: Record<string, unknown>,
	telemetryCfg: WallboxControlTelemetryCfg,
	objectMetas: WallboxControlObjectMetaMap,
): WallboxControlMappingSnapshot {
	const meta = (id: string) => objectMetas[id];
	const contract = resolveEvccModeControlContract(config);
	const diagnosis = contractDiagnosis(config, "evcc");
	const setMode =
		contract.resolvedVariant === "string_mode"
			? evccEntryFromConfig(
					"set_mode",
					config,
					telemetryCfg.modeReadbackStateId || contract.modeFeedbackStateId,
					true,
					meta(evccControlTargetForRole(config, "set_mode")),
				)
			: null;
	const maxCurrentId =
		contract.maxCurrentStateId ||
		(contract.resolvedVariant === "string_mode" ? evccControlTargetForRole(config, "set_max_current_a") : "");
	const setMaxCurrentA = evccEntryFromStateId(
		"set_max_current_a",
		maxCurrentId,
		telemetryCfg.maxCurrentAStateId,
		true,
		meta(maxCurrentId),
	);
	const phaseId =
		contract.resolvedVariant === "string_mode"
			? evccControlTargetForRole(config, "set_phase")
			: contract.phasesConfiguredStateId;
	const setPhase = evccEntryFromStateId("set_phase", phaseId, "", false, meta(phaseId));
	const chargeModeValue =
		contract.resolvedVariant === "string_mode" ? evccModeChargeValue(config) || null : null;
	const holdModeValue = contract.resolvedVariant === "string_mode" ? evccModeHoldValue(config) || null : null;
	const modeMeta = setMode ? meta(setMode.targetStateId) : undefined;
	const modeValueIssues: string[] = [];
	let chargeModeValueConfirmed = false;
	let holdModeValueConfirmed = false;
	if (contract.resolvedVariant === "string_mode") {
		if (chargeModeValue && setMode) {
			const v = validateEnumValueAgainstMeta(chargeModeValue, modeMeta);
			chargeModeValueConfirmed = v.valid;
			if (!v.valid) modeValueIssues.push(`charge_mode:${v.reason}`);
		} else if (!chargeModeValue) {
			modeValueIssues.push("charge_mode:evcc_charge_mode_mapping_missing");
		}
		if (holdModeValue && setMode) {
			const v = validateEnumValueAgainstMeta(holdModeValue, modeMeta);
			holdModeValueConfirmed = v.valid;
			if (!v.valid) modeValueIssues.push(`hold_mode:${v.reason}`);
		}
	}
	const missingRoles: string[] = [...contract.missing];
	const buttonIssues =
		contract.resolvedVariant === "buttons" ? buttonValidationIssues(config, objectMetas) : [];
	const validationIssues = [
		...collectValidationIssues(
			contract.resolvedVariant === "string_mode" ? [setMode, setMaxCurrentA] : [setMaxCurrentA],
		),
		...modeValueIssues,
		...buttonIssues,
	];
	const stringPathConfirmed =
		contract.resolvedVariant === "string_mode" &&
		Boolean(setMode?.contractValid && setMaxCurrentA?.contractValid && chargeModeValueConfirmed) &&
		setMode?.semanticRole === "evcc_mode" &&
		setMaxCurrentA?.semanticRole === "evcc_max_current";
	const evccControlPathConfirmed =
		contract.resolvedVariant === "string_mode"
			? stringPathConfirmed
			: contract.writeContractReady && buttonIssues.length === 0;
	const liveEligible =
		contract.resolvedVariant === "string_mode" && stringPathConfirmed && validationIssues.length === 0;
	let controlPathReason = "evcc_control_path_unconfirmed";
	if (liveEligible) controlPathReason = "evcc_control_path_confirmed";
	else if (contract.resolvedVariant === "buttons") {
		controlPathReason = contract.writeContractReady
			? "evcc_buttons_not_live_released"
			: contract.missing[0] ?? "evcc_buttons_incomplete";
	} else if (contract.resolvedVariant === "pv_control") {
		controlPathReason = contract.writeContractReady
			? "evcc_pv_control_not_live_released"
			: contract.missing[0] ?? "evcc_pv_control_incomplete";
	} else {
		controlPathReason =
			validationIssues[0] ?? (missingRoles.length > 0 ? "mapping_incomplete" : "evcc_control_path_unconfirmed");
	}
	return {
		controlModel: "evcc",
		legacyMappingsPresent: hasLegacyWallboxWriteMapping(config),
		evccMappingsPresent: hasEvccControlWriteMapping(config),
		setEnabled: null,
		setCurrentA: null,
		setChargePowerW: null,
		setMode,
		setMaxCurrentA,
		setPhase,
		evccChargeModeValue: chargeModeValue,
		evccHoldModeValue: holdModeValue,
		chargeModeValueConfirmed,
		holdModeValueConfirmed,
		chargeControlRole: null,
		missingRoles,
		ambiguousPowerControl: false,
		mappingConflictReason: null,
		evccControlPathConfirmed,
		liveEligible,
		controlPathReason,
		validationIssues,
		...diagnosis,
	};
}

function buildLegacyDirectSnapshot(
	config: Record<string, unknown>,
	telemetryCfg: WallboxControlTelemetryCfg,
	objectMetas: WallboxControlObjectMetaMap,
): WallboxControlMappingSnapshot {
	const legacy = legacyWallboxMappingFromConfig(config);
	const meta = (id: string) => objectMetas[id];
	const setEnabled = legacyEntryFromConfig("set_enabled", config, legacy, telemetryCfg.enabledStateId, true, meta(legacy.set_enabled?.target_state?.trim() || flatTarget(config, WALLBOX_FLAT_PREFIX.set_enabled)));
	const setCurrentA = legacyEntryFromConfig("set_current_a", config, legacy, "", false, meta(legacy.set_current_a?.target_state?.trim() || flatTarget(config, WALLBOX_FLAT_PREFIX.set_current_a)));
	const setChargePowerW = legacyEntryFromConfig("set_charge_power_w", config, legacy, "", false, meta(legacy.set_charge_power_w?.target_state?.trim() || flatTarget(config, WALLBOX_FLAT_PREFIX.set_charge_power_w)));
	const missingRoles: string[] = [];
	if (!setEnabled) missingRoles.push("set_enabled");
	const roleResolution = resolveChargeControlRole(setCurrentA, setChargePowerW);
	if (!roleResolution.chargeControlRole && !roleResolution.ambiguousPowerControl) missingRoles.push("set_current_a|set_charge_power_w");
	const chargeEntry = roleResolution.chargeControlRole === "set_current_a" ? setCurrentA : roleResolution.chargeControlRole === "set_charge_power_w" ? setChargePowerW : null;
	const validationIssues = collectValidationIssues([setEnabled, chargeEntry]);
	const contractStructurallyComplete = missingRoles.length === 0 && !roleResolution.ambiguousPowerControl && validationIssues.length === 0;
	return {
		controlModel: "legacy_direct",
		legacyMappingsPresent: hasLegacyWallboxWriteMapping(config),
		evccMappingsPresent: hasEvccControlWriteMapping(config),
		setEnabled,
		setCurrentA,
		setChargePowerW,
		...emptyEvccFields(),
		chargeControlRole: roleResolution.chargeControlRole,
		missingRoles,
		ambiguousPowerControl: roleResolution.ambiguousPowerControl,
		mappingConflictReason: roleResolution.mappingConflictReason,
		evccControlPathConfirmed: false,
		liveEligible: false,
		controlPathReason: "legacy_direct_not_live_eligible",
		validationIssues,
		...contractDiagnosis(config, "legacy_direct"),
	};
}

export interface BuildWallboxControlMappingSnapshotInput {
	config: Record<string, unknown>;
	telemetryCfg: WallboxControlTelemetryCfg;
	objectMetas?: WallboxControlObjectMetaMap;
}

export function buildWallboxControlMappingSnapshot(input: BuildWallboxControlMappingSnapshotInput): WallboxControlMappingSnapshot {
	const controlModel = resolveWallboxControlModel(input.config);
	const objectMetas = input.objectMetas ?? {};
	if (controlModel === "none") return buildNoneSnapshot(input.config);
	if (controlModel === "evcc") return buildEvccSnapshot(input.config, input.telemetryCfg, objectMetas);
	return buildLegacyDirectSnapshot(input.config, input.telemetryCfg, objectMetas);
}

export { collectConfiguredControlTargetStateIds };
