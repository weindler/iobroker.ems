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
exports.assertNoForbiddenImportRoots = exports.collectTransitiveRelativeImports = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const SRC_ROOT = path.join(process.cwd(), "src");
function resolveModuleFile(fromFile, spec) {
    if (!spec.startsWith(".")) {
        return null;
    }
    const base = path.resolve(path.dirname(fromFile), spec);
    const candidates = [`${base}.ts`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.js")];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
function parseRelativeImports(filePath) {
    const text = fs.readFileSync(filePath, "utf8");
    const specs = [];
    const patterns = [
        /\bfrom\s+["'](\.[^"']+)["']/g,
        /\bimport\s+["'](\.[^"']+)["']/g,
        /\bexport\s+.*\bfrom\s+["'](\.[^"']+)["']/g,
    ];
    for (const re of patterns) {
        let match;
        while ((match = re.exec(text))) {
            specs.push(match[1]);
        }
    }
    return specs;
}
/** Collects transitive relative import closure from a TypeScript entry file. */
function collectTransitiveRelativeImports(entryRelativePath) {
    const entry = path.join(SRC_ROOT, entryRelativePath);
    const visited = new Set();
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.pop();
        if (visited.has(file))
            continue;
        visited.add(file);
        for (const spec of parseRelativeImports(file)) {
            const resolved = resolveModuleFile(file, spec);
            if (resolved && !visited.has(resolved)) {
                queue.push(resolved);
            }
        }
    }
    return [...visited].sort();
}
exports.collectTransitiveRelativeImports = collectTransitiveRelativeImports;
function assertNoForbiddenImportRoots(entryRelativePaths, forbiddenRoots) {
    for (const entry of entryRelativePaths) {
        const files = collectTransitiveRelativeImports(entry);
        for (const file of files) {
            const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
            for (const forbidden of forbiddenRoots) {
                if (rel === forbidden || rel.startsWith(`${forbidden}/`)) {
                    throw new Error(`forbidden import root ${forbidden} reached from ${entry}: ${rel}`);
                }
            }
        }
    }
}
exports.assertNoForbiddenImportRoots = assertNoForbiddenImportRoots;
