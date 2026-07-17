import type { PlannerRuntimeMode } from "../planner_config";
import type { PlannerTakeoverEvaluationMode } from "../planner_config/evaluation_mode";
import type { PlannerRequestedAuthority } from "../planner_config/authoritative_source";
import type { PlannerTakeoverEvidence } from "../planner_takeover/types";
import type { PlannerPlanCandidate } from "../planner_candidate/types";
import type { PlannerPathLayout } from "../planner_paths/paths";
import type { AuthorityBoundRevisions, PlannerAuthorityService } from "./service";

interface AuthorityRuntimeSession {
	service: PlannerAuthorityService | null;
	layout: PlannerPathLayout | null;
	configuredSource: PlannerRequestedAuthority;
	runtimeMode: PlannerRuntimeMode;
	evaluationMode: PlannerTakeoverEvaluationMode;
	executionMode: string;
	evidence: PlannerTakeoverEvidence | null;
	bound: AuthorityBoundRevisions | null;
	candidate: PlannerPlanCandidate | null;
	adapterReady: boolean;
	shuttingDown: boolean;
	sessionId: string;
}

const session: AuthorityRuntimeSession = {
	service: null,
	layout: null,
	configuredSource: "legacy",
	runtimeMode: "off",
	evaluationMode: "disabled",
	executionMode: "dryrun",
	evidence: null,
	bound: null,
	candidate: null,
	adapterReady: true,
	shuttingDown: false,
	sessionId: `auth-sess-${Date.now().toString(36)}`,
};

export function configureAuthoritySession(partial: Partial<AuthorityRuntimeSession>): void {
	Object.assign(session, partial);
}

export function getAuthoritySession(): AuthorityRuntimeSession {
	return session;
}

export function resetAuthoritySessionForTest(): void {
	session.service = null;
	session.layout = null;
	session.configuredSource = "legacy";
	session.runtimeMode = "off";
	session.evaluationMode = "disabled";
	session.executionMode = "dryrun";
	session.evidence = null;
	session.bound = null;
	session.candidate = null;
	session.adapterReady = true;
	session.shuttingDown = false;
	session.sessionId = `auth-sess-${Date.now().toString(36)}`;
}
