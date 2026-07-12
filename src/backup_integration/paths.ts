import * as path from "node:path";

export type PathResolverInput =
	| string
	| { namespace: string; getAbsoluteInstanceDataDir?: () => string };

export interface EmsPathLayout {
	durableDataDir: string;
	runtimeDataDir: string;
	manifestPath: string;
	migrationStatusPath: string;
	runtimeIntentDir: string;
	runtimeGlobalModesDir: string;
	runtimeAddonDir: (addon: "immersion_heater" | "air_conditioning") => string;
	runtimeExportsDir: string;
	runtimeRestoreInboxDir: string;
	runtimeTransactionsDir: string;
	runtimeRecoveryDir: string;
	runtimeQuarantineDir: string;
	runtimeTempDir: string;
	bootGuardPath: string;
	legacyTransactionsDir: string;
}

const TRAVERSAL_RE = /\.\.|[/\\]|\0/;

export function parseInstanceFromNamespace(namespace: string): number {
	const parts = namespace.split(".");
	const n = Number.parseInt(parts[parts.length - 1] ?? "0", 10);
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function assertSafeRelativeSegment(segment: string): void {
	if (!segment || TRAVERSAL_RE.test(segment)) {
		throw new Error("invalid path segment");
	}
}

export function durableDataDirFromRoot(ioBrokerDataRoot: string, instance: number): string {
	return path.join(ioBrokerDataRoot, `ems.${instance}`);
}

export function runtimeDataDirFromRoot(ioBrokerDataRoot: string, instance: number): string {
	return path.join(ioBrokerDataRoot, `ems-runtime.${instance}`);
}

export function resolveIoBrokerDataRoot(durableDataDir: string, namespace: string): string {
	const normalized = path.resolve(durableDataDir);
	const instance = parseInstanceFromNamespace(namespace);
	const suffix = `ems.${instance}`;
	if (normalized.endsWith(suffix) || normalized.endsWith(`${path.sep}${suffix}`)) {
		return path.dirname(normalized);
	}
	return normalized;
}

export function resolveDurableDataDir(input: PathResolverInput): string {
	if (typeof input === "string") {
		return path.resolve(input);
	}
	if (typeof input.getAbsoluteInstanceDataDir === "function") {
		return path.resolve(input.getAbsoluteInstanceDataDir());
	}
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const utils = require("@iobroker/adapter-core") as typeof import("@iobroker/adapter-core");
	return path.resolve(utils.getAbsoluteInstanceDataDir(input as ioBroker.Adapter));
}

export function resolveNamespace(input: PathResolverInput): string {
	if (typeof input === "string") {
		const base = path.basename(input);
		if (/^ems\.\d+$/.test(base)) return base;
		return "ems.0";
	}
	return input.namespace;
}

export function resolveEmsPaths(input: PathResolverInput): EmsPathLayout {
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

/** Category-aware absolute path — learning/policy under durable, runtime categories under runtime. */
export function categoryDataPath(layout: EmsPathLayout, category?: string): string {
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

export function assertPathWithinRoot(resolvedPath: string, root: string): void {
	const resolved = path.resolve(resolvedPath);
	const base = path.resolve(root);
	if (resolved !== base && !resolved.startsWith(base + path.sep)) {
		throw new Error("path outside allowed root");
	}
}
