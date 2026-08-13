import type { WallboxEvccControlRole } from "../evcc_control_config";
import { EVCC_BUTTON_SUFFIXES, isEvccModeButtonStateId, isEvccModeFeedbackStateId } from "../evcc_mode_control";

export type WallboxControlTargetKind = "evcc" | "goe_direct" | "user_configured";

export type WallboxEvccSemanticRole =
	| "evcc_mode"
	| "evcc_mode_feedback"
	| "evcc_mode_button_off"
	| "evcc_mode_button_pv"
	| "evcc_mode_button_min"
	| "evcc_mode_button_now"
	| "evcc_max_current"
	| "evcc_min_current"
	| "evcc_enabled_status"
	| "evcc_phases"
	| "legacy_enabled"
	| "legacy_current"
	| "unknown";

export function classifyWallboxControlTargetKind(stateId: string): WallboxControlTargetKind {
	const id = stateId.trim().toLowerCase();
	if (id.startsWith("evcc.")) return "evcc";
	if (id.startsWith("go-e.")) return "goe_direct";
	return "user_configured";
}

/** Heuristische EVCC-Semantik aus State-ID — nicht allein aus common.write oder evcc.*-Präfix. */
export function inferEvccSemanticRole(stateId: string): WallboxEvccSemanticRole {
	const id = stateId.trim().toLowerCase();
	if (isEvccModeFeedbackStateId(stateId)) return "evcc_mode_feedback";
	if (isEvccModeButtonStateId(stateId, "off")) return "evcc_mode_button_off";
	if (isEvccModeButtonStateId(stateId, "pv")) return "evcc_mode_button_pv";
	if (isEvccModeButtonStateId(stateId, "now")) return "evcc_mode_button_now";
	if (isEvccModeButtonStateId(stateId, "min")) return "evcc_mode_button_min";
	if (id.includes("mincurrent")) return "evcc_min_current";
	if (id.includes("maxcurrent")) return "evcc_max_current";
	if (id.includes(".enabled") || id.endsWith("enabled")) return "evcc_enabled_status";
	if (id.includes("mode")) return "evcc_mode";
	if (id.includes("phase")) return "evcc_phases";
	return "unknown";
}

export function requiredSemanticForEvccRole(role: WallboxEvccControlRole): WallboxEvccSemanticRole {
	switch (role) {
		case "set_mode":
			return "evcc_mode";
		case "set_max_current_a":
			return "evcc_max_current";
		case "set_phase":
			return "evcc_phases";
		default:
			return "unknown";
	}
}

export function validateEvccSemanticRole(
	role: WallboxEvccControlRole,
	stateId: string,
): { valid: boolean; reason: string | null; semanticRole: WallboxEvccSemanticRole } {
	const semanticRole = inferEvccSemanticRole(stateId);
	const required = requiredSemanticForEvccRole(role);
	if (semanticRole === "evcc_min_current") {
		return { valid: false, reason: "min_current_not_max_current", semanticRole };
	}
	if (role === "set_mode" && semanticRole === "evcc_enabled_status") {
		return { valid: false, reason: "enabled_not_evcc_mode", semanticRole };
	}
	if (semanticRole !== required) {
		return { valid: false, reason: `${required}_semantics_unconfirmed`, semanticRole };
	}
	return { valid: true, reason: null, semanticRole };
}

export interface WallboxControlObjectMeta {
	stateId: string;
	objectPresent: boolean;
	writable: boolean;
	readable: boolean;
	commonType: string | null;
	allowedStateKeys: string[] | null;
}

export type WallboxControlObjectMetaMap = Record<string, WallboxControlObjectMeta>;

type GetObjectAsync = (id: string) => Promise<ioBroker.Object | null | undefined>;

export function metaFromObject(stateId: string, obj: ioBroker.Object | null | undefined): WallboxControlObjectMeta {
	if (!obj || !obj.common) {
		return {
			stateId,
			objectPresent: false,
			writable: false,
			readable: false,
			commonType: null,
			allowedStateKeys: null,
		};
	}
	const common = obj.common;
	const states = common.states;
	let allowedStateKeys: string[] | null = null;
	if (states && typeof states === "object") {
		allowedStateKeys = Object.keys(states);
	}
	return {
		stateId,
		objectPresent: true,
		writable: common.write === true,
		readable: common.read !== false,
		commonType: typeof common.type === "string" ? common.type : null,
		allowedStateKeys,
	};
}

export async function resolveWallboxControlObjectMeta(
	getObjectAsync: GetObjectAsync | undefined,
	stateId: string,
): Promise<WallboxControlObjectMeta> {
	const id = stateId.trim();
	if (!id || !getObjectAsync) {
		return {
			stateId: id,
			objectPresent: false,
			writable: false,
			readable: false,
			commonType: null,
			allowedStateKeys: null,
		};
	}
	try {
		const obj = await getObjectAsync(id);
		return metaFromObject(id, obj);
	} catch {
		return metaFromObject(id, null);
	}
}

export async function resolveWallboxControlObjectMetas(
	getObjectAsync: GetObjectAsync | undefined,
	stateIds: string[],
): Promise<WallboxControlObjectMetaMap> {
	const unique = [...new Set(stateIds.map((s) => s.trim()).filter(Boolean))];
	const out: WallboxControlObjectMetaMap = {};
	await Promise.all(
		unique.map(async (id) => {
			out[id] = await resolveWallboxControlObjectMeta(getObjectAsync, id);
		}),
	);
	return out;
}

export function isDirectGoeStateId(stateId: string): boolean {
	return stateId.trim().toLowerCase().startsWith("go-e.");
}

export function isEvccNamespaceStateId(stateId: string): boolean {
	return stateId.trim().toLowerCase().startsWith("evcc.");
}

export function validateControlObjectMeta(
	meta: WallboxControlObjectMeta | undefined,
	expectedType: "boolean" | "number" | "string",
): { valid: boolean; reason: string | null } {
	if (!meta || !meta.objectPresent) {
		return { valid: false, reason: "target_object_missing" };
	}
	if (!meta.writable) {
		return { valid: false, reason: "target_not_writable" };
	}
	if (
		meta.commonType &&
		meta.commonType !== expectedType &&
		meta.commonType !== "mixed"
	) {
		return { valid: false, reason: "target_type_mismatch" };
	}
	return { valid: true, reason: null };
}

/** Button-States: write=true / read=false are valid write targets. */
export function validateEvccButtonTargetMeta(
	stateId: string,
	button: keyof typeof EVCC_BUTTON_SUFFIXES,
	meta: WallboxControlObjectMeta | undefined,
): { valid: boolean; reason: string | null; semanticRole: WallboxEvccSemanticRole } {
	const semanticRole = inferEvccSemanticRole(stateId);
	if (isDirectGoeStateId(stateId)) {
		return { valid: false, reason: "goe_target_not_evcc_compatible", semanticRole };
	}
	if (!isEvccNamespaceStateId(stateId)) {
		return { valid: false, reason: "evcc_namespace_not_confirmed", semanticRole };
	}
	if (isEvccModeFeedbackStateId(stateId)) {
		return { valid: false, reason: "mode_feedback_not_a_write_target", semanticRole };
	}
	if (!isEvccModeButtonStateId(stateId, button)) {
		return { valid: false, reason: `${EVCC_BUTTON_SUFFIXES[button]}_semantics_unconfirmed`, semanticRole };
	}
	const base = validateControlObjectMeta(meta, "boolean");
	if (!base.valid) {
		return { ...base, semanticRole };
	}
	return { valid: true, reason: null, semanticRole };
}

export function validateEvccModeFeedbackMeta(
	stateId: string,
	meta: WallboxControlObjectMeta | undefined,
): { valid: boolean; reason: string | null } {
	if (isDirectGoeStateId(stateId)) {
		return { valid: false, reason: "goe_target_not_evcc_compatible" };
	}
	if (!stateId.trim()) {
		return { valid: false, reason: "mode_feedback_unmapped" };
	}
	if (!meta || !meta.objectPresent) {
		return { valid: false, reason: "mode_feedback_object_missing" };
	}
	if (meta.writable && !meta.readable) {
		return { valid: false, reason: "mode_feedback_not_readable" };
	}
	return { valid: true, reason: null };
}

export function validateEvccControlTargetMeta(
	stateId: string,
	expectedType: "boolean" | "number" | "string",
	meta: WallboxControlObjectMeta | undefined,
	role: WallboxEvccControlRole,
): { valid: boolean; reason: string | null; semanticRole: WallboxEvccSemanticRole } {
	if (isDirectGoeStateId(stateId)) {
		return { valid: false, reason: "goe_target_not_evcc_compatible", semanticRole: inferEvccSemanticRole(stateId) };
	}
	if (!isEvccNamespaceStateId(stateId)) {
		return { valid: false, reason: "evcc_namespace_not_confirmed", semanticRole: inferEvccSemanticRole(stateId) };
	}
	if (isEvccModeFeedbackStateId(stateId)) {
		return {
			valid: false,
			reason: "mode_feedback_not_a_write_target",
			semanticRole: inferEvccSemanticRole(stateId),
		};
	}
	const semantic = validateEvccSemanticRole(role, stateId);
	if (!semantic.valid) {
		return { valid: false, reason: semantic.reason, semanticRole: semantic.semanticRole };
	}
	const base = validateControlObjectMeta(meta, expectedType);
	if (!base.valid) {
		return { ...base, semanticRole: semantic.semanticRole };
	}
	return { valid: true, reason: null, semanticRole: semantic.semanticRole };
}

export function validateEnumValueAgainstMeta(
	value: string,
	meta: WallboxControlObjectMeta | undefined,
): { valid: boolean; reason: string | null } {
	if (!meta?.allowedStateKeys || meta.allowedStateKeys.length === 0) {
		return { valid: false, reason: "enum_values_unconfirmed" };
	}
	if (!meta.allowedStateKeys.includes(value)) {
		return { valid: false, reason: "enum_value_not_allowed" };
	}
	return { valid: true, reason: null };
}

export function expectedTypeForEvccRole(role: WallboxEvccControlRole): "boolean" | "number" | "string" {
	switch (role) {
		case "set_max_current_a":
		case "set_phase":
			return "number";
		case "set_mode":
			return "string";
		default:
			return "string";
	}
}
