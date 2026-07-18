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
exports.assertPathWithinRoot = exports.categoryDataPath = exports.resolveEmsPaths = exports.resolveNamespace = exports.resolveDurableDataDir = exports.resolveIoBrokerDataRoot = exports.runtimeDataDirFromRoot = exports.durableDataDirFromRoot = exports.assertSafeRelativeSegment = exports.parseInstanceFromNamespace = void 0;
const path = __importStar(require("node:path"));
const TRAVERSAL_RE = /\.\.|[/\\]|\0/;
function parseInstanceFromNamespace(namespace) {
    const parts = namespace.split(".");
    const n = Number.parseInt(parts[parts.length - 1] ?? "0", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}
exports.parseInstanceFromNamespace = parseInstanceFromNamespace;
function assertSafeRelativeSegment(segment) {
    if (!segment || TRAVERSAL_RE.test(segment)) {
        throw new Error("invalid path segment");
    }
}
exports.assertSafeRelativeSegment = assertSafeRelativeSegment;
function durableDataDirFromRoot(ioBrokerDataRoot, instance) {
    return path.join(ioBrokerDataRoot, `ems.${instance}`);
}
exports.durableDataDirFromRoot = durableDataDirFromRoot;
function runtimeDataDirFromRoot(ioBrokerDataRoot, instance) {
    return path.join(ioBrokerDataRoot, `ems-runtime.${instance}`);
}
exports.runtimeDataDirFromRoot = runtimeDataDirFromRoot;
function resolveIoBrokerDataRoot(durableDataDir, namespace) {
    const normalized = path.resolve(durableDataDir);
    const instance = parseInstanceFromNamespace(namespace);
    const suffix = `ems.${instance}`;
    if (normalized.endsWith(suffix) || normalized.endsWith(`${path.sep}${suffix}`)) {
        return path.dirname(normalized);
    }
    return normalized;
}
exports.resolveIoBrokerDataRoot = resolveIoBrokerDataRoot;
function resolveDurableDataDir(input) {
    if (typeof input === "string") {
        return path.resolve(input);
    }
    if (typeof input.durableDataDir === "string" && input.durableDataDir.length > 0) {
        return path.resolve(input.durableDataDir);
    }
    if (typeof input.getAbsoluteInstanceDataDir === "function") {
        return path.resolve(input.getAbsoluteInstanceDataDir());
    }
    // Real ioBroker: instance data dir comes from adapter-core, not from an adapter method.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const utils = require("@iobroker/adapter-core");
    return path.resolve(utils.getAbsoluteInstanceDataDir(input));
}
exports.resolveDurableDataDir = resolveDurableDataDir;
function resolveNamespace(input) {
    if (typeof input === "string") {
        const base = path.basename(input);
        if (/^ems\.\d+$/.test(base))
            return base;
        return "ems.0";
    }
    return input.namespace;
}
exports.resolveNamespace = resolveNamespace;
function resolveEmsPaths(input) {
    const namespace = resolveNamespace(input);
    const instance = parseInstanceFromNamespace(namespace);
    const durableDataDir = resolveDurableDataDir(input);
    const ioBrokerDataRoot = resolveIoBrokerDataRoot(durableDataDir, namespace);
    const runtimeDataDir = runtimeDataDirFromRoot(ioBrokerDataRoot, instance);
    return {
        durableDataDir,
        runtimeDataDir,
        manifestPath: path.join(durableDataDir, "manifest.json"),
        migrationStatusPath: path.join(durableDataDir, "migration", "status.json"),
        runtimeIntentDir: path.join(runtimeDataDir, "runtime", "intent"),
        runtimeGlobalModesDir: path.join(runtimeDataDir, "runtime", "global_modes"),
        runtimeAddonDir: (addon) => path.join(runtimeDataDir, "runtime", "addons", addon),
        runtimeExportsDir: path.join(runtimeDataDir, "exports"),
        runtimeRestoreInboxDir: path.join(runtimeDataDir, "restore", "inbox"),
        runtimeTransactionsDir: path.join(runtimeDataDir, "restore", "transactions"),
        runtimeRecoveryDir: path.join(runtimeDataDir, "recovery"),
        runtimeQuarantineDir: path.join(runtimeDataDir, "quarantine"),
        runtimeTempDir: path.join(runtimeDataDir, "temp"),
        bootGuardPath: path.join(runtimeDataDir, "recovery", "boot-guard.json"),
        legacyTransactionsDir: path.join(durableDataDir, "restore", "transactions"),
    };
}
exports.resolveEmsPaths = resolveEmsPaths;
/** Category-aware absolute path — learning/policy under durable, runtime categories under runtime. */
function categoryDataPath(layout, category) {
    if (!category) {
        return layout.durableDataDir;
    }
    if (category.includes("..") || category.includes("\0")) {
        throw new Error("invalid path category");
    }
    if (category.startsWith("learning/") || category === "policy") {
        return path.join(layout.durableDataDir, category);
    }
    if (category === "intent") {
        return layout.runtimeIntentDir;
    }
    if (category === "global_modes") {
        return layout.runtimeGlobalModesDir;
    }
    if (category === "immersion_heater") {
        return layout.runtimeAddonDir("immersion_heater");
    }
    if (category === "air_conditioning") {
        return layout.runtimeAddonDir("air_conditioning");
    }
    return path.join(layout.durableDataDir, category);
}
exports.categoryDataPath = categoryDataPath;
function assertPathWithinRoot(resolvedPath, root) {
    const resolved = path.resolve(resolvedPath);
    const base = path.resolve(root);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
        throw new Error("path outside allowed root");
    }
}
exports.assertPathWithinRoot = assertPathWithinRoot;
