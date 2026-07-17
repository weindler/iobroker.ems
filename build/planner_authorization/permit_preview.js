"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryMintCanonicalPublishPermitWithGrant = exports.evaluateCanonicalPermitMintPreview = void 0;
const grant_1 = require("./grant");
const activation_1 = require("./activation");
const permit_1 = require("../planner_publish/permit");
/**
 * Diagnostic permit-mint preview. Never mints a CanonicalPublishPermit.
 * Even with a valid grant, ends at activation_blocked when capability is missing.
 */
function evaluateCanonicalPermitMintPreview(input) {
    const grantValid = input.grant != null &&
        (0, grant_1.isAuthorizationGrant)(input.grant) &&
        !(0, grant_1.grantExpired)(input.grant, input.nowMs);
    const activation = (0, activation_1.tryMintProductiveActivationCapability)({
        grantPresent: grantValid,
        evidenceReady: input.evidenceReady,
    });
    const productiveActivationCapabilityPresent = false;
    void activation; // always null in Phase 3G
    const permit = (0, permit_1.tryMintCanonicalPublishPermitFromShadow)({
        evaluationState: input.evidenceReady ? "ready" : "not_evaluated",
        requestedTarget: "canonical",
        productiveTakeoverMode: false,
    });
    void permit; // always null
    const blockReasons = [];
    if (!grantValid)
        blockReasons.push("authorization_grant_invalid");
    else
        blockReasons.push("activation_capability_missing");
    if (!input.evidenceReady)
        blockReasons.push("evidence_not_ready");
    if (!input.revisionMatch)
        blockReasons.push("revision_mismatch");
    if (!input.executionModeDryrun)
        blockReasons.push("execution_mode_not_dryrun");
    if (input.releaseGateClosed)
        blockReasons.push("release_gate_closed");
    if (grantValid && !blockReasons.includes("activation_capability_missing")) {
        blockReasons.push("activation_capability_missing");
    }
    let authorizationState = "not_requested";
    if (input.authorizationState === "ineligible")
        authorizationState = "ineligible";
    else if (input.authorizationState === "prepared")
        authorizationState = "prepared";
    else if (input.authorizationState === "confirmed" ||
        input.authorizationState === "activation_blocked") {
        authorizationState = "activation_blocked";
    }
    return {
        authorizationState,
        authorizationGrantValid: grantValid,
        productiveActivationCapabilityPresent,
        wouldPassRevisionChecks: input.revisionMatch,
        wouldPassEvidenceChecks: input.evidenceReady,
        wouldPassExecutionModeChecks: input.executionModeDryrun,
        wouldPassPublishChecks: !input.releaseGateClosed,
        permitMinted: false,
        canonicalAllowed: false,
        primaryBlockReason: blockReasons[0] ?? null,
        blockReasonCount: blockReasons.length,
    };
}
exports.evaluateCanonicalPermitMintPreview = evaluateCanonicalPermitMintPreview;
/**
 * Phase 3G mint attempt — always returns null.
 * Requires both grant AND ProductiveTakeoverActivationCapability (unavailable).
 */
function tryMintCanonicalPublishPermitWithGrant(_input) {
    const cap = (0, activation_1.tryMintProductiveActivationCapability)({ grantPresent: _input.grant != null });
    if (!cap)
        return null;
    // Unreachable in Phase 3G — kept for future multi-factor mint.
    return null;
}
exports.tryMintCanonicalPublishPermitWithGrant = tryMintCanonicalPublishPermitWithGrant;
