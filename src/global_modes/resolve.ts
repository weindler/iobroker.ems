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
