"use strict";
/** Lightweight promise mutex for serialized authorization operations. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthorizationMutex = void 0;
class AuthorizationMutex {
    tail = Promise.resolve();
    runExclusive(fn) {
        const run = this.tail.then(() => fn());
        this.tail = run.then(() => undefined, () => undefined);
        return run;
    }
}
exports.AuthorizationMutex = AuthorizationMutex;
