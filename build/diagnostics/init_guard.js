"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetModuleInitGuardForTest = exports.getDuplicateModuleInits = exports.getModuleInitMarks = exports.getModuleInitCounts = exports.markModuleInit = void 0;
const initCounts = new Map();
const initMarks = [];
function markModuleInit(module, atMs = Date.now()) {
    const count = (initCounts.get(module) ?? 0) + 1;
    initCounts.set(module, count);
    const mark = {
        module,
        count,
        duplicate: count > 1,
        atMs,
    };
    initMarks.push(mark);
    return mark;
}
exports.markModuleInit = markModuleInit;
function getModuleInitCounts() {
    return new Map(initCounts);
}
exports.getModuleInitCounts = getModuleInitCounts;
function getModuleInitMarks() {
    return [...initMarks];
}
exports.getModuleInitMarks = getModuleInitMarks;
function getDuplicateModuleInits() {
    return initMarks.filter((m) => m.duplicate);
}
exports.getDuplicateModuleInits = getDuplicateModuleInits;
function resetModuleInitGuardForTest() {
    initCounts.clear();
    initMarks.length = 0;
}
exports.resetModuleInitGuardForTest = resetModuleInitGuardForTest;
