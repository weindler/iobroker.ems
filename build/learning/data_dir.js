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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.learningDataPath = learningDataPath;
exports.learningDataPathFromRoot = learningDataPathFromRoot;
exports.resolveAdapterPaths = resolveAdapterPaths;
exports.withLearningDataPath = withLearningDataPath;
exports.runtimeExportsDir = runtimeExportsDir;
exports.durableInstanceDir = durableInstanceDir;
exports.runtimeTransactionsDir = runtimeTransactionsDir;
exports.joinSafe = joinSafe;
const path = __importStar(require("node:path"));
const paths_1 = require("../backup_integration/paths");
/** Absoluter Instanz-Datenordner für Learning-Artefakte (Freeze-JSON, Persist). */
function learningDataPath(adapter, category) {
    return (0, paths_1.categoryDataPath)((0, paths_1.resolveEmsPaths)(adapter), category);
}
function learningDataPathFromRoot(durableDataDir, category) {
    const layout = (0, paths_1.resolveEmsPaths)(durableDataDir);
    return (0, paths_1.categoryDataPath)(layout, category);
}
function resolveAdapterPaths(input) {
    return (0, paths_1.resolveEmsPaths)(input);
}
/** Erweitert host um getAbsolutePath — ohne das Ursprungsobjekt zu mutieren. */
function withLearningDataPath(adapter, host) {
    const layout = (0, paths_1.resolveEmsPaths)(adapter);
    const out = Object.create(host);
    out.getAbsolutePath = (category) => (0, paths_1.categoryDataPath)(layout, category);
    out.getEmsPaths = () => layout;
    return out;
}
/** Legacy helper — runtime exports root. */
function runtimeExportsDir(adapter) {
    return (0, paths_1.resolveEmsPaths)(adapter).runtimeExportsDir;
}
/** @deprecated Use resolveEmsPaths().durableDataDir */
function durableInstanceDir(adapter) {
    return (0, paths_1.resolveEmsPaths)(adapter).durableDataDir;
}
/** Runtime transactions directory. */
function runtimeTransactionsDir(adapter) {
    return (0, paths_1.resolveEmsPaths)(adapter).runtimeTransactionsDir;
}
function joinSafe(base, ...parts) {
    return path.join(base, ...parts);
}
