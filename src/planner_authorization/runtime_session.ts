import type { PlannerRuntimeMode } from "../planner_config";
import type { PlannerTakeoverEvaluationMode } from "../planner_config/evaluation_mode";
import type { PlannerTakeoverAuthorizationMode } from "../planner_config/authorization_mode";
import type { PlannerTakeoverEvidence } from "../planner_takeover/types";
import type { AuthorizationBoundRevisions } from "./service";
import type { PlannerAuthorizationService } from "./service";

interface AuthRuntimeSession {
	service: PlannerAuthorizationService | null;
	runtimeMode: PlannerRuntimeMode;
	evaluationMode: PlannerTakeoverEvaluationMode;
	authorizationMode: PlannerTakeoverAuthorizationMode;
	evidence: PlannerTakeoverEvidence | null;
	bound: AuthorizationBoundRevisions | null;
	lastCompareStatus: string | null;
	authoritativePublishOk: boolean;
	candidateValid: boolean;
	plannerJobActive: boolean;
	pendingRerun: boolean;
	executionMode: string;
	adapterReady: boolean;
	shuttingDown: boolean;
	restoreBarrierActive: boolean;
	operationLockActive: boolean;
	sessionId: string;
	/** Phase 3H: dryrun pilot readiness stands in for full evidence ready. */
	dryrunPilotReady: boolean;
}

const session: AuthRuntimeSession = {
	service: null,
	runtimeMode: "off",
	evaluationMode: "disabled",
	authorizationMode: "disabled",
	evidence: null,
	bound: null,
	lastCompareStatus: null,
	authoritativePublishOk: true,
	candidateValid: true,
	plannerJobActive: false,
	pendingRerun: false,
	executionMode: "dryrun",
	adapterReady: true,
	shuttingDown: false,
	restoreBarrierActive: false,
	operationLockActive: false,
	sessionId: `sess-${Date.now().toString(36)}`,
	dryrunPilotReady: false,
};

export function configureAuthorizationSession(partial: Partial<AuthRuntimeSession>): void {
	Object.assign(session, partial);
}

export function getAuthorizationSession(): AuthRuntimeSession {
	return session;
}

export function resetAuthorizationSessionForTest(): void {
	session.service = null;
	session.runtimeMode = "off";
	session.evaluationMode = "disabled";
	session.authorizationMode = "disabled";
	session.evidence = null;
	session.bound = null;
	session.lastCompareStatus = null;
	session.authoritativePublishOk = true;
	session.candidateValid = true;
	session.plannerJobActive = false;
	session.pendingRerun = false;
	session.executionMode = "dryrun";
	session.adapterReady = true;
	session.shuttingDown = false;
	session.restoreBarrierActive = false;
	session.operationLockActive = false;
	session.sessionId = `sess-${Date.now().toString(36)}`;
	session.dryrunPilotReady = false;
}
