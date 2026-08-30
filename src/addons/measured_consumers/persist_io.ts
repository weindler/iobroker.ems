import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile, DIAGNOSTIC_FILE_MODE } from "../../persistence/atomic_write";
import {
	MEASURED_CONSUMERS_RUNTIME_FILENAME,
	emptyMeasuredConsumersPersist,
	emptyMeasuredConsumerSlotPersist,
	type MeasuredConsumersPersist,
	type MeasuredConsumerSlotPersist,
} from "./persist";

/** Exakter Persist-Key der Tauchpumpe (Wh-Alias-Fehlbuchung vor Korrektur). */
export const TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY =
	"alias.0.Garten.Sensoren.Tauchpumpe_Bewässerung.Aktuelle_Leistung";

export const TAUCHPUMPE_WH_RESET_MIGRATION_ID = "tauchpumpe_wh_reset_v1";

export type MeasuredConsumersPersistV1 = MeasuredConsumersPersist & {
	migrationsApplied?: string[];
};

/**
 * Einmal-Reset nur für die Tauchpumpe nach Wh→kWh-Alias-Korrektur.
 * Verwirft falsche days/total/baseline; nächstes Sample initialisiert neu mit initial_energy_kwh.
 */
export function applyTauchpumpeWhResetMigration(
	persist: MeasuredConsumersPersistV1,
): { persist: MeasuredConsumersPersistV1; reset: boolean } {
	const applied = new Set(persist.migrationsApplied ?? []);
	if (applied.has(TAUCHPUMPE_WH_RESET_MIGRATION_ID)) {
		return { persist, reset: false };
	}
	const key = TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY;
	const nextSlots: Record<string, MeasuredConsumerSlotPersist> = { ...persist.slots };
	let reset = false;
	if (nextSlots[key]) {
		nextSlots[key] = emptyMeasuredConsumerSlotPersist();
		reset = true;
	}
	applied.add(TAUCHPUMPE_WH_RESET_MIGRATION_ID);
	return {
		persist: {
			version: 1,
			slots: nextSlots,
			migrationsApplied: [...applied],
		},
		reset,
	};
}

export async function readMeasuredConsumersPersist(baseDir: string): Promise<MeasuredConsumersPersistV1> {
	try {
		const raw = await fs.readFile(path.join(baseDir, MEASURED_CONSUMERS_RUNTIME_FILENAME), "utf8");
		const parsed = JSON.parse(raw) as MeasuredConsumersPersistV1;
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
			const base: MeasuredConsumersPersistV1 = {
				version: 1,
				slots,
				migrationsApplied: Array.isArray(parsed.migrationsApplied)
					? parsed.migrationsApplied.filter((x): x is string => typeof x === "string")
					: [],
			};
			return applyTauchpumpeWhResetMigration(base).persist;
		}
	} catch {
		// neu / noch keine Persistenz vorhanden
	}
	const empty = emptyMeasuredConsumersPersist() as MeasuredConsumersPersistV1;
	empty.migrationsApplied = [TAUCHPUMPE_WH_RESET_MIGRATION_ID];
	return empty;
}

export async function writeMeasuredConsumersPersist(
	baseDir: string,
	persist: MeasuredConsumersPersistV1,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	await atomicWriteFile(
		path.join(baseDir, MEASURED_CONSUMERS_RUNTIME_FILENAME),
		`${JSON.stringify(persist, null, 2)}\n`,
		{ mode: DIAGNOSTIC_FILE_MODE },
	);
}
