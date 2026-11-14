"use strict";
/** Gemeinsamer exklusiver Lock für Export- und Restore-Operationen. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOperationRunning = isOperationRunning;
exports.currentOperationKind = currentOperationKind;
exports.tryAcquireOperationLock = tryAcquireOperationLock;
exports.releaseOperationLock = releaseOperationLock;
exports.resetOperationLockForTest = resetOperationLockForTest;
let lockHeld = false;
let lockKind = null;
function isOperationRunning() {
    return lockHeld;
}
function currentOperationKind() {
    return lockKind;
}
function tryAcquireOperationLock(kind) {
    if (lockHeld) {
        return { ok: false, error: "operation_already_running" };
    }
    lockHeld = true;
    lockKind = kind;
    return { ok: true };
}
function releaseOperationLock() {
    lockHeld = false;
    lockKind = null;
}
function resetOperationLockForTest() {
    releaseOperationLock();
}
