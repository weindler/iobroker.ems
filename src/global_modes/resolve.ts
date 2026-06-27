import { createHash } from "node:crypto";
import { sortIssuesDeterministic } from "../policy/core/normalize";
import { stableStringify } from "../policy/core/hash";
import { DEFAULT_GLOBAL_MODE, type GlobalMode } from "./constants";
import { profileForMode } from "./schema";
import { isGlobalMode } from "./config";
import type { GlobalModeResolution } from "./types";
import type { PolicyIssue } from "../policy/core/types";

export function validateRequestedMode(raw: unknown): { mode: GlobalMode | null; issue: PolicyIssue | null } {
	if (raw === null || raw === undefined || raw === "") {
		return { mode: null, issue: null };
	}
	const s = String(raw).trim().toLowerCase();
	if (!s) {
		return { mode: null, issue: null };
	}
	if (isGlobalMode(s)) {
		return { mode: s, issue: null };
	}
	return {
		mode: null,
		issue: {
			code: "global_mode_invalid",
			severity: "error",
			path: "global_modes.requested",
			message: `Ungültiger Global Mode: ${s}`,
		},
	};
}

export interface ResolveGlobalModesInput {
	requestedRaw: unknown;
	adminDefault: GlobalMode;
	/** true wenn requested bereits ein gültiger persistierter Benutzerwert ist */
	hasPersistedRequested: boolean;
}

export type RequestedDecisionReason = "first_init" | "admin_changed" | "keep";

export interface RequestedWriteDecisionInput {
	/** Aktueller Wert von global_modes.requested (Roh). */
	currentRequestedRaw: unknown;
	/** Normalisierter Admin-Default aus der Konfiguration. */
	adminDefault: GlobalMode;
	/** Zuletzt gemerkter Admin-Default (global_modes.admin_default) oder null. */
	lastAdminSeen: string | null;
}

export interface RequestedWriteDecision {
	/** Wenn gesetzt: dieser Wert soll nach global_modes.requested geschrieben werden. */
	writeRequested: GlobalMode | null;
	reason: RequestedDecisionReason;
}

/**
 * Entscheidet, ob global_modes.requested überschrieben werden soll.
 * - Erstinitialisierung (kein Laufzeitwert): Admin-Default übernehmen.
 * - Admin-Default wurde aktiv geändert (≠ zuletzt gemerkt): als explizite
 *   Benutzerwahl übernehmen.
 * - Sonst: bestehenden Laufzeitwert beibehalten (z. B. Datenpunkt-Steuerung).
 *
 * Ein bloßer Adapter-Neustart ohne geänderten Admin-Default überschreibt den
 * Laufzeitwert nicht.
 */
export function decideRequestedWrite(input: RequestedWriteDecisionInput): RequestedWriteDecision {
	const cur = input.currentRequestedRaw;
	const hasRequested = cur !== undefined && cur !== null && String(cur).trim() !== "";

	if (!hasRequested) {
		return { writeRequested: input.adminDefault, reason: "first_init" };
	}
	if (input.lastAdminSeen !== null && input.lastAdminSeen !== input.adminDefault) {
		return { writeRequested: input.adminDefault, reason: "admin_changed" };
	}
	return { writeRequested: null, reason: "keep" };
}

export function resolveGlobalModes(input: ResolveGlobalModesInput): GlobalModeResolution {
	const issues: PolicyIssue[] = [];
	const validated = validateRequestedMode(input.requestedRaw);

	let requested: GlobalMode;
	let active: GlobalMode;
	let valid = true;
	let status: GlobalModeResolution["status"] = "ready";

	if (validated.mode !== null) {
		requested = validated.mode;
		active = validated.mode;
	} else if (validated.issue) {
		requested = DEFAULT_GLOBAL_MODE;
		active = DEFAULT_GLOBAL_MODE;
		valid = false;
		status = "fallback";
		issues.push(validated.issue);
		issues.push({
			code: "global_mode_fallback",
			severity: "warning",
			path: "global_modes.active",
			message: `Fallback auf ${DEFAULT_GLOBAL_MODE} wegen ungültigem requested: ${String(input.requestedRaw)}`,
		});
	} else {
		requested = input.adminDefault;
		active = input.adminDefault;
	}

	const profile = profileForMode(active);
	const sortedIssues = sortIssuesDeterministic(issues);
	const revisionPayload = {
		requested,
		active,
		valid,
		status,
		profile,
		issues: sortedIssues,
	};
	const hash = createHash("sha256").update(stableStringify(revisionPayload), "utf8").digest("hex");

	return {
		requested,
		active,
		valid,
		status,
		issues: sortedIssues,
		profile,
		revision: hash.slice(0, 16),
	};
}
