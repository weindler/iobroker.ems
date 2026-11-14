"use strict";
/** Test- und Diagnose-Hooks für gezielte Fehler-Injektion (nur Restore-Apply/Rollback). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setRestoreApplyInjectionPoint = setRestoreApplyInjectionPoint;
exports.setRestoreRollbackInjectionPoint = setRestoreRollbackInjectionPoint;
exports.setRestoreHandlerInjectionAfterCommitted = setRestoreHandlerInjectionAfterCommitted;
exports.resetRestoreInjectionHooksForTest = resetRestoreInjectionHooksForTest;
exports.maybeInjectRestoreApplyFailure = maybeInjectRestoreApplyFailure;
exports.maybeInjectRestoreRollbackFailure = maybeInjectRestoreRollbackFailure;
exports.maybeInjectRestoreHandlerAfterCommitted = maybeInjectRestoreHandlerAfterCommitted;
let applyInjectionPoint = null;
let rollbackInjectionPoint = null;
let handlerInjectionAfterCommitted = false;
function setRestoreApplyInjectionPoint(point) {
    applyInjectionPoint = point;
}
function setRestoreRollbackInjectionPoint(point) {
    rollbackInjectionPoint = point;
}
function setRestoreHandlerInjectionAfterCommitted(active) {
    handlerInjectionAfterCommitted = active;
}
function resetRestoreInjectionHooksForTest() {
    applyInjectionPoint = null;
    rollbackInjectionPoint = null;
    handlerInjectionAfterCommitted = false;
}
async function maybeInjectRestoreApplyFailure(point) {
    if (applyInjectionPoint === point) {
        throw new Error(`injected_failure:${point}`);
    }
}
async function maybeInjectRestoreRollbackFailure(point) {
    if (rollbackInjectionPoint === point) {
        throw new Error(`injected_failure:${point}`);
    }
}
function maybeInjectRestoreHandlerAfterCommitted() {
    if (handlerInjectionAfterCommitted) {
        throw new Error("injected_failure:after_committed_before_status");
    }
}
