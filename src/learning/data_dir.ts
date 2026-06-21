import * as path from "node:path";
import * as utils from "@iobroker/adapter-core";

/** Absoluter Instanz-Datenordner für Learning-Artefakte (Freeze-JSON, Persist). */
export function learningDataPath(adapter: ioBroker.Adapter, category?: string): string {
	const base = utils.getAbsoluteInstanceDataDir(adapter);
	return category ? path.join(base, category) : base;
}

export type LearningDataHost = {
	getAbsolutePath: (category?: string) => string;
};

export function withLearningDataPath<H extends object>(
	adapter: ioBroker.Adapter,
	host: H,
): H & LearningDataHost {
	return {
		...host,
		getAbsolutePath: (category?: string) => learningDataPath(adapter, category),
	};
}
