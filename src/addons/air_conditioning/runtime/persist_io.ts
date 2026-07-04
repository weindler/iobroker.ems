import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AC_RUNTIME_FILENAME, emptyAcRuntimePersist, type AcRuntimePersist } from "./persist";

export async function readAcRuntimePersist(baseDir: string): Promise<AcRuntimePersist> {
	try {
		const raw = await fs.readFile(path.join(baseDir, AC_RUNTIME_FILENAME), "utf8");
		const parsed = JSON.parse(raw) as AcRuntimePersist;
		if (parsed?.version === 1 && parsed.units && typeof parsed.units === "object") {
			return parsed;
		}
	} catch {
		// neu
	}
	return emptyAcRuntimePersist();
}

export async function writeAcRuntimePersist(baseDir: string, persist: AcRuntimePersist): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	await fs.writeFile(
		path.join(baseDir, AC_RUNTIME_FILENAME),
		`${JSON.stringify(persist, null, 2)}\n`,
		"utf8",
	);
}
