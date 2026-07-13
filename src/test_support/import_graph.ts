import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.join(process.cwd(), "src");

function resolveModuleFile(fromFile: string, spec: string): string | null {
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

function parseRelativeImports(filePath: string): string[] {
	const text = fs.readFileSync(filePath, "utf8");
	const specs: string[] = [];
	const patterns = [
		/\bfrom\s+["'](\.[^"']+)["']/g,
		/\bimport\s+["'](\.[^"']+)["']/g,
		/\bexport\s+.*\bfrom\s+["'](\.[^"']+)["']/g,
	];
	for (const re of patterns) {
		let match: RegExpExecArray | null;
		while ((match = re.exec(text))) {
			specs.push(match[1]);
		}
	}
	return specs;
}

/** Collects transitive relative import closure from a TypeScript entry file. */
export function collectTransitiveRelativeImports(entryRelativePath: string): string[] {
	const entry = path.join(SRC_ROOT, entryRelativePath);
	const visited = new Set<string>();
	const queue = [entry];

	while (queue.length > 0) {
		const file = queue.pop()!;
		if (visited.has(file)) continue;
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

export function assertNoForbiddenImportRoots(
	entryRelativePaths: string[],
	forbiddenRoots: string[],
): void {
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
