import * as path from "node:path";
import {
	categoryDataPath,
	resolveEmsPaths,
	type EmsPathLayout,
	type PathResolverInput,
} from "../backup_integration/paths";

/** Absoluter Instanz-Datenordner für Learning-Artefakte (Freeze-JSON, Persist). */
export function learningDataPath(adapter: ioBroker.Adapter, category?: string): string {
	return categoryDataPath(resolveEmsPaths(adapter), category);
}

export function learningDataPathFromRoot(durableDataDir: string, category?: string): string {
	const layout = resolveEmsPaths(durableDataDir);
	return categoryDataPath(layout, category);
}

export function resolveAdapterPaths(input: PathResolverInput): EmsPathLayout {
	return resolveEmsPaths(input);
}

export type LearningDataHost = {
	getAbsolutePath: (category?: string) => string;
	getEmsPaths?: () => EmsPathLayout;
};

/** Erweitert host um getAbsolutePath — ohne das Ursprungsobjekt zu mutieren. */
export function withLearningDataPath<H extends object>(
	adapter: ioBroker.Adapter,
	host: H,
): H & LearningDataHost {
	const layout = resolveEmsPaths(adapter);
	const out = Object.create(host) as H & LearningDataHost;
	out.getAbsolutePath = (category?: string) => categoryDataPath(layout, category);
	out.getEmsPaths = () => layout;
	return out;
}

/** Legacy helper — runtime exports root. */
export function runtimeExportsDir(adapter: ioBroker.Adapter): string {
	return resolveEmsPaths(adapter).runtimeExportsDir;
}

/** @deprecated Use resolveEmsPaths().durableDataDir */
export function durableInstanceDir(adapter: ioBroker.Adapter): string {
	return resolveEmsPaths(adapter).durableDataDir;
}

/** Runtime transactions directory. */
export function runtimeTransactionsDir(adapter: ioBroker.Adapter): string {
	return resolveEmsPaths(adapter).runtimeTransactionsDir;
}

export function joinSafe(base: string, ...parts: string[]): string {
	return path.join(base, ...parts);
}
