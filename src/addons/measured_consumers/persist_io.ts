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
			const slots: MeasuredConsumersPersist["slots"] = {};
			for (const [key, slot] of Object.entries(parsed.slots)) {
				if (!slot || typeof slot !== "object") continue;
				slots[key] = {
					initialized: Boolean(slot.initialized),
					rawEnergyBaselineKwh:
						typeof slot.rawEnergyBaselineKwh === "number" && Number.isFinite(slot.rawEnergyBaselineKwh)
							? slot.rawEnergyBaselineKwh
							: null,
					lastPowerTsMs:
						typeof slot.lastPowerTsMs === "number" && Number.isFinite(slot.lastPowerTsMs)
							? slot.lastPowerTsMs
							: null,
					totalKwh:
						typeof slot.totalKwh === "number" && Number.isFinite(slot.totalKwh) ? slot.totalKwh : 0,
					days:
						slot.days && typeof slot.days === "object" && !Array.isArray(slot.days)
							? { ...(slot.days as Record<string, number>) }
							: {},
				};
			}
			return { version: 1, slots };
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
