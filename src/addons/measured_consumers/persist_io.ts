import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	MEASURED_CONSUMERS_RUNTIME_FILENAME,
	emptyMeasuredConsumersPersist,
	type MeasuredConsumersPersist,
} from "./persist";

export async function readMeasuredConsumersPersist(baseDir: string): Promise<MeasuredConsumersPersist> {
	try {
		const raw = await fs.readFile(path.join(baseDir, MEASURED_CONSUMERS_RUNTIME_FILENAME), "utf8");
		const parsed = JSON.parse(raw) as MeasuredConsumersPersist;
		if (parsed?.version === 1 && parsed.slots && typeof parsed.slots === "object") {
			return parsed;
		}
	} catch {
		// neu / noch keine Persistenz vorhanden
	}
	return emptyMeasuredConsumersPersist();
}

export async function writeMeasuredConsumersPersist(baseDir: string, persist: MeasuredConsumersPersist): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	await fs.writeFile(
		path.join(baseDir, MEASURED_CONSUMERS_RUNTIME_FILENAME),
		`${JSON.stringify(persist, null, 2)}\n`,
		"utf8",
	);
}
