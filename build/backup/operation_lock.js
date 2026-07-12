"use strict";
/** Gemeinsamer exklusiver Lock für Export- und Restore-Operationen. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetOperationLockForTest = exports.releaseOperationLock = exports.tryAcquireOperationLock = exports.currentOperationKind = exports.isOperationRunning = void 0;
let lockHeld = false;
let lockKind = null;
function isOperationRunning() {
    return lockHeld;
}
exports.isOperationRunning = isOperationRunning;
function currentOperationKind() {
    return lockKind;
}
exports.currentOperationKind = currentOperationKind;
function tryAcquireOperationLock(kind) {
    if (lockHeld) {
        return { ok: false, error: "operation_already_running" };
    }
    lockHeld = true;
    lockKind = kind;
    return { ok: true };
}
exports.tryAcquireOperationLock = tryAcquireOperationLock;
function releaseOperationLock() {
    lockHeld = false;
    lockKind = null;
}
exports.releaseOperationLock = releaseOperationLock;
function resetOperationLockForTest() {
    releaseOperationLock();
}
exports.resetOperationLockForTest = resetOperationLockForTest;
