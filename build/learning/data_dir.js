"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withLearningDataPath = exports.learningDataPath = void 0;
const path = __importStar(require("node:path"));
/** Absoluter Instanz-Datenordner für Learning-Artefakte (Freeze-JSON, Persist). */
function learningDataPath(adapter, category) {
    const adapterAny = adapter;
    let base;
    if (typeof adapterAny.getAbsoluteInstanceDataDir === "function") {
        base = adapterAny.getAbsoluteInstanceDataDir();
    }
    else {
        // Lazy: vermeidet js-controller-Abhängigkeit beim Modul-Import (Tests, Cold Start).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const utils = require("@iobroker/adapter-core");
        base = utils.getAbsoluteInstanceDataDir(adapter);
    }
    return category ? path.join(base, category) : base;
}
exports.learningDataPath = learningDataPath;
/** Erweitert host um getAbsolutePath — ohne das Ursprungsobjekt zu mutieren. */
function withLearningDataPath(adapter, host) {
    const out = Object.create(host);
    out.getAbsolutePath = (category) => learningDataPath(adapter, category);
    return out;
}
exports.withLearningDataPath = withLearningDataPath;
