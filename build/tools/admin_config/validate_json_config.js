"use strict";
/**
 * Validiert admin/jsonConfig.json gegen das offizielle ioBroker-jsonConfig-Schema
 * (ioBroker/ioBroker.admin packages/jsonConfig/schemas/jsonConfig.json).
 *
 * Kein vollständiger Draft-07-Engine: prüft genau die Fehlerklasse, die Admin
 * als "invalid jsonConfig" / additionalProperties / must match then schema
 * reportet — erlaubte Keys je Control-Typ aus den if/then-$ref des Schemas.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateJsonConfig = exports.collectControls = exports.allowedKeysByType = void 0;
function resolveRef(schema, ref) {
    if (!ref.startsWith("#/")) {
        throw new Error(`unsupported $ref: ${ref}`);
    }
    let cur = schema;
    for (const part of ref.slice(2).split("/")) {
        if (!cur || typeof cur !== "object") {
            throw new Error(`unresolved $ref: ${ref}`);
        }
        cur = cur[part];
    }
    if (!cur || typeof cur !== "object") {
        throw new Error(`unresolved $ref: ${ref}`);
    }
    return cur;
}
function collectPropertyKeys(schema, node) {
    const keys = new Set();
    if (!node)
        return keys;
    if (node.$ref) {
        return collectPropertyKeys(schema, resolveRef(schema, node.$ref));
    }
    if (Array.isArray(node.allOf)) {
        for (const part of node.allOf) {
            for (const k of collectPropertyKeys(schema, part))
                keys.add(k);
        }
    }
    if (node.properties && typeof node.properties === "object") {
        for (const k of Object.keys(node.properties))
            keys.add(k);
    }
    return keys;
}
/** type → erlaubte Property-Namen laut Schema (Union aller if/then-Zweige). */
function allowedKeysByType(schema) {
    const map = new Map();
    function walk(node) {
        if (!node || typeof node !== "object")
            return;
        if (Array.isArray(node)) {
            for (const item of node)
                walk(item);
            return;
        }
        const n = node;
        const typeConst = n.if?.properties?.type?.const;
        if (typeof typeConst === "string" && n.then) {
            const keys = collectPropertyKeys(schema, n.then);
            const prev = map.get(typeConst) ?? new Set();
            for (const k of keys)
                prev.add(k);
            map.set(typeConst, prev);
        }
        for (const v of Object.values(n))
            walk(v);
    }
    walk(schema);
    return map;
}
exports.allowedKeysByType = allowedKeysByType;
function collectControls(node, path, out) {
    if (!node || typeof node !== "object")
        return;
    if (Array.isArray(node)) {
        node.forEach((item, i) => collectControls(item, `${path}/${i}`, out));
        return;
    }
    const obj = node;
    if (typeof obj.type === "string") {
        out.push({ path, type: obj.type, obj });
    }
    if (obj.items && typeof obj.items === "object") {
        if (Array.isArray(obj.items)) {
            collectControls(obj.items, `${path}/items`, out);
        }
        else {
            for (const [key, val] of Object.entries(obj.items)) {
                collectControls(val, `${path}/items/${key}`, out);
            }
        }
    }
}
exports.collectControls = collectControls;
function validateJsonConfig(config, schema) {
    const issues = [];
    if (!config || typeof config !== "object") {
        return [{ path: "", message: "jsonConfig must be an object" }];
    }
    const root = config;
    const allowedByType = allowedKeysByType(schema);
    const rootType = typeof root.type === "string" ? root.type : "";
    if (rootType === "tabs") {
        const rootAllowed = allowedByType.get("tabs");
        if (rootAllowed) {
            for (const key of Object.keys(root)) {
                if (!rootAllowed.has(key) && key !== "$schema") {
                    issues.push({
                        path: `/${key}`,
                        property: key,
                        message: `must NOT have additional properties`,
                    });
                }
            }
        }
    }
    const controls = [];
    collectControls(root, "", controls);
    for (const c of controls) {
        const allowed = allowedByType.get(c.type);
        if (!allowed || allowed.size === 0)
            continue;
        for (const key of Object.keys(c.obj)) {
            if (!allowed.has(key)) {
                issues.push({
                    path: `${c.path}`,
                    property: key,
                    message: `additionalProperty: "${key}" must NOT have additional properties`,
                });
            }
        }
    }
    return issues;
}
exports.validateJsonConfig = validateJsonConfig;
