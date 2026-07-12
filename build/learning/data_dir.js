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
exports.joinSafe = exports.runtimeTransactionsDir = exports.durableInstanceDir = exports.runtimeExportsDir = exports.withLearningDataPath = exports.resolveAdapterPaths = exports.learningDataPathFromRoot = exports.learningDataPath = void 0;
const path = __importStar(require("node:path"));
const paths_1 = require("../backup_integration/paths");
/** Absoluter Instanz-Datenordner für Learning-Artefakte (Freeze-JSON, Persist). */
function learningDataPath(adapter, category) {
    return (0, paths_1.categoryDataPath)((0, paths_1.resolveEmsPaths)(adapter), category);
}
exports.learningDataPath = learningDataPath;
function learningDataPathFromRoot(durableDataDir, category) {
    const layout = (0, paths_1.resolveEmsPaths)(durableDataDir);
    return (0, paths_1.categoryDataPath)(layout, category);
}
exports.learningDataPathFromRoot = learningDataPathFromRoot;
function resolveAdapterPaths(input) {
    return (0, paths_1.resolveEmsPaths)(input);
}
exports.resolveAdapterPaths = resolveAdapterPaths;
/** Erweitert host um getAbsolutePath — ohne das Ursprungsobjekt zu mutieren. */
function withLearningDataPath(adapter, host) {
    const layout = (0, paths_1.resolveEmsPaths)(adapter);
    const out = Object.create(host);
    out.getAbsolutePath = (category) => (0, paths_1.categoryDataPath)(layout, category);
    out.getEmsPaths = () => layout;
    return out;
}
exports.withLearningDataPath = withLearningDataPath;
/** Legacy helper — runtime exports root. */
function runtimeExportsDir(adapter) {
    return (0, paths_1.resolveEmsPaths)(adapter).runtimeExportsDir;
}
exports.runtimeExportsDir = runtimeExportsDir;
/** @deprecated Use resolveEmsPaths().durableDataDir */
function durableInstanceDir(adapter) {
    return (0, paths_1.resolveEmsPaths)(adapter).durableDataDir;
}
exports.durableInstanceDir = durableInstanceDir;
/** Runtime transactions directory. */
function runtimeTransactionsDir(adapter) {
    return (0, paths_1.resolveEmsPaths)(adapter).runtimeTransactionsDir;
}
exports.runtimeTransactionsDir = runtimeTransactionsDir;
function joinSafe(base, ...parts) {
    return path.join(base, ...parts);
}
exports.joinSafe = joinSafe;
