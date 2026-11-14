"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.beginBootstrapRun = beginBootstrapRun;
exports.getBootstrapRunContext = getBootstrapRunContext;
exports.endBootstrapRun = endBootstrapRun;
let activeBootstrapContext = null;
function beginBootstrapRun(coldStartRecovery) {
    activeBootstrapContext = { coldStartRecovery };
    return activeBootstrapContext;
}
function getBootstrapRunContext() {
    return activeBootstrapContext;
}
function endBootstrapRun() {
    activeBootstrapContext = null;
}
