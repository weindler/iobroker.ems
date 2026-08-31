/**
 * Validiert admin/jsonConfig.json gegen das offizielle ioBroker-jsonConfig-Schema
 * (ioBroker/ioBroker.admin packages/jsonConfig/schemas/jsonConfig.json).
 *
 * Kein vollständiger Draft-07-Engine: prüft genau die Fehlerklasse, die Admin
 * als "invalid jsonConfig" / additionalProperties / must match then schema
 * reportet — erlaubte Keys je Control-Typ aus den if/then-$ref des Schemas.
 */

export type JsonConfigSchemaIssue = {
	path: string;
	message: string;
	property?: string;
};

type JsonSchemaNode = {
	$ref?: string;
	allOf?: JsonSchemaNode[];
	if?: { properties?: { type?: { const?: string } } };
	then?: JsonSchemaNode;
	properties?: Record<string, unknown>;
	additionalProperties?: boolean;
	required?: string[];
	[key: string]: unknown;
};

function resolveRef(schema: JsonSchemaNode, ref: string): JsonSchemaNode {
	if (!ref.startsWith("#/")) {
		throw new Error(`unsupported $ref: ${ref}`);
	}
	let cur: unknown = schema;
	for (const part of ref.slice(2).split("/")) {
		if (!cur || typeof cur !== "object") {
			throw new Error(`unresolved $ref: ${ref}`);
		}
		cur = (cur as Record<string, unknown>)[part];
	}
	if (!cur || typeof cur !== "object") {
		throw new Error(`unresolved $ref: ${ref}`);
	}
	return cur as JsonSchemaNode;
}

function collectPropertyKeys(schema: JsonSchemaNode, node: JsonSchemaNode | undefined): Set<string> {
	const keys = new Set<string>();
	if (!node) return keys;
	if (node.$ref) {
		return collectPropertyKeys(schema, resolveRef(schema, node.$ref));
	}
	if (Array.isArray(node.allOf)) {
		for (const part of node.allOf) {
			for (const k of collectPropertyKeys(schema, part)) keys.add(k);
		}
	}
	if (node.properties && typeof node.properties === "object") {
		for (const k of Object.keys(node.properties)) keys.add(k);
	}
	return keys;
}

/** type → erlaubte Property-Namen laut Schema (Union aller if/then-Zweige). */
export function allowedKeysByType(schema: JsonSchemaNode): Map<string, Set<string>> {
	const map = new Map<string, Set<string>>();
	function walk(node: unknown): void {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) walk(item);
			return;
		}
		const n = node as JsonSchemaNode;
		const typeConst = n.if?.properties?.type?.const;
		if (typeof typeConst === "string" && n.then) {
			const keys = collectPropertyKeys(schema, n.then);
			const prev = map.get(typeConst) ?? new Set<string>();
			for (const k of keys) prev.add(k);
			map.set(typeConst, prev);
		}
		for (const v of Object.values(n)) walk(v);
	}
	walk(schema);
	return map;
}

export function collectControls(
	node: unknown,
	path: string,
	out: Array<{ path: string; type: string; obj: Record<string, unknown> }>,
): void {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		node.forEach((item, i) => collectControls(item, `${path}/${i}`, out));
		return;
	}
	const obj = node as Record<string, unknown>;
	if (typeof obj.type === "string") {
		out.push({ path, type: obj.type, obj });
	}
	if (obj.items && typeof obj.items === "object") {
		if (Array.isArray(obj.items)) {
			collectControls(obj.items, `${path}/items`, out);
		} else {
			for (const [key, val] of Object.entries(obj.items as Record<string, unknown>)) {
				collectControls(val, `${path}/items/${key}`, out);
			}
		}
	}
}

export function validateJsonConfig(
	config: unknown,
	schema: JsonSchemaNode,
): JsonConfigSchemaIssue[] {
	const issues: JsonConfigSchemaIssue[] = [];
	if (!config || typeof config !== "object") {
		return [{ path: "", message: "jsonConfig must be an object" }];
	}
	const root = config as Record<string, unknown>;
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

	const controls: Array<{ path: string; type: string; obj: Record<string, unknown> }> = [];
	collectControls(root, "", controls);

	for (const c of controls) {
		const allowed = allowedByType.get(c.type);
		if (!allowed || allowed.size === 0) continue;
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
