"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyEconomicsPersist = exports.emptyEtaPath = exports.emptyAlphaBeta = void 0;
const constants_1 = require("./constants");
function emptyAlphaBeta(reasonDe) {
    return {
        usable: false,
        alpha: null,
        beta: null,
        confidence: 0,
        pairCount: 0,
        episodePairCount: 0,
        slotPairCount: 0,
        alphaIqr: null,
        betaIqr: null,
        reasonDe,
    };
}
exports.emptyAlphaBeta = emptyAlphaBeta;
function emptyEtaPath(reasonDe) {
    return {
        etaPvPath: null,
        etaGridPath: null,
        etaPvUsable: false,
        etaGridUsable: false,
        pvSessionCount: 0,
        gridSessionCount: 0,
        reasonDe,
    };
}
exports.emptyEtaPath = emptyEtaPath;
function emptyEconomicsPersist(generatedAt, reasonDe) {
    return {
        module: constants_1.GRID_BALANCE_ECONOMICS_MODULE,
        schemaVersion: constants_1.GRID_BALANCE_ECONOMICS_SCHEMA,
        generatedAt,
        alphaBeta: emptyAlphaBeta(reasonDe),
        eta: emptyEtaPath(reasonDe),
    };
}
exports.emptyEconomicsPersist = emptyEconomicsPersist;
