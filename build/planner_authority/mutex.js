"use strict";
/** Lightweight promise mutex for serialized authority operations. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthorityMutex = void 0;
class AuthorityMutex {
    tail = Promise.resolve();
    runExclusive(fn) {
        const run = this.tail.then(() => fn());
        this.tail = run.then(() => undefined, () => undefined);
        return run;
    }
}
exports.AuthorityMutex = AuthorityMutex;
