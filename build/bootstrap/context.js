"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.endBootstrapRun = exports.getBootstrapRunContext = exports.beginBootstrapRun = void 0;
let activeBootstrapContext = null;
function beginBootstrapRun(coldStartRecovery) {
    activeBootstrapContext = { coldStartRecovery };
    return activeBootstrapContext;
}
exports.beginBootstrapRun = beginBootstrapRun;
function getBootstrapRunContext() {
    return activeBootstrapContext;
}
exports.getBootstrapRunContext = getBootstrapRunContext;
function endBootstrapRun() {
    activeBootstrapContext = null;
}
exports.endBootstrapRun = endBootstrapRun;
