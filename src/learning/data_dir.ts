import * as path from "node:path";

/** Absoluter Instanz-Datenordner für Learning-Artefakte (Freeze-JSON, Persist). */
export function learningDataPath(adapter: ioBroker.Adapter, category?: string): string {
	const adapterAny = adapter as ioBroker.Adapter & { getAbsoluteInstanceDataDir?: () => string };
	let base: string;
	if (typeof adapterAny.getAbsoluteInstanceDataDir === "function") {
		base = adapterAny.getAbsoluteInstanceDataDir();
	} else {
		// Lazy: vermeidet js-controller-Abhängigkeit beim Modul-Import (Tests, Cold Start).
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const utils = require("@iobroker/adapter-core") as typeof import("@iobroker/adapter-core");
		base = utils.getAbsoluteInstanceDataDir(adapter);
	}
	return category ? path.join(base, category) : base;
}

export type LearningDataHost = {
	getAbsolutePath: (category?: string) => string;
};

/** Erweitert host um getAbsolutePath — ohne das Ursprungsobjekt zu mutieren. */
export function withLearningDataPath<H extends object>(
	adapter: ioBroker.Adapter,
	host: H,
): H & LearningDataHost {
	const out = Object.create(host) as H & LearningDataHost;
	out.getAbsolutePath = (category?: string) => learningDataPath(adapter, category);
	return out;
}
