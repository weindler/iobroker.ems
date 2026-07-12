"use strict";
/** Test- und Diagnose-Hooks für gezielte Fehler-Injektion (nur Restore-Apply/Rollback). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.maybeInjectRestoreHandlerAfterCommitted = exports.maybeInjectRestoreRollbackFailure = exports.maybeInjectRestoreApplyFailure = exports.resetRestoreInjectionHooksForTest = exports.setRestoreHandlerInjectionAfterCommitted = exports.setRestoreRollbackInjectionPoint = exports.setRestoreApplyInjectionPoint = void 0;
let applyInjectionPoint = null;
let rollbackInjectionPoint = null;
let handlerInjectionAfterCommitted = false;
function setRestoreApplyInjectionPoint(point) {
    applyInjectionPoint = point;
}
exports.setRestoreApplyInjectionPoint = setRestoreApplyInjectionPoint;
function setRestoreRollbackInjectionPoint(point) {
    rollbackInjectionPoint = point;
}
exports.setRestoreRollbackInjectionPoint = setRestoreRollbackInjectionPoint;
function setRestoreHandlerInjectionAfterCommitted(active) {
    handlerInjectionAfterCommitted = active;
}
exports.setRestoreHandlerInjectionAfterCommitted = setRestoreHandlerInjectionAfterCommitted;
function resetRestoreInjectionHooksForTest() {
    applyInjectionPoint = null;
    rollbackInjectionPoint = null;
    handlerInjectionAfterCommitted = false;
}
exports.resetRestoreInjectionHooksForTest = resetRestoreInjectionHooksForTest;
async function maybeInjectRestoreApplyFailure(point) {
    if (applyInjectionPoint === point) {
        throw new Error(`injected_failure:${point}`);
    }
}
exports.maybeInjectRestoreApplyFailure = maybeInjectRestoreApplyFailure;
async function maybeInjectRestoreRollbackFailure(point) {
    if (rollbackInjectionPoint === point) {
        throw new Error(`injected_failure:${point}`);
    }
}
exports.maybeInjectRestoreRollbackFailure = maybeInjectRestoreRollbackFailure;
function maybeInjectRestoreHandlerAfterCommitted() {
    if (handlerInjectionAfterCommitted) {
        throw new Error("injected_failure:after_committed_before_status");
    }
}
exports.maybeInjectRestoreHandlerAfterCommitted = maybeInjectRestoreHandlerAfterCommitted;
