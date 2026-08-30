import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile, DIAGNOSTIC_FILE_MODE } from "../../persistence/atomic_write";
import {
	MEASURED_CONSUMERS_RUNTIME_FILENAME,
	emptyMeasuredConsumersPersist,
	type MeasuredConsumersPersist,
} from "./persist";

/** Exakter Persist-Key der Tauchpumpe (Wh-Alias-Fehlbuchung vor Korrektur). */
export const TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY =
	"alias.0.Garten.Sensoren.Tauchpumpe_Bewässerung.Aktuelle_Leistung";

export const TAUCHPUMPE_WH_RESET_MIGRATION_ID = "tauchpumpe_wh_reset_v1";

export type MeasuredConsumersPersistV1 = MeasuredConsumersPersist & {
	migrationsApplied?: string[];
};

export type TauchpumpeWhResetResult = {
	persist: MeasuredConsumersPersistV1;
	/** Persistenzinhalt muss geschrieben werden (Reset und/oder Marker). */
	changed: boolean;
	/** Zielslot war vorhanden und wurde entfernt. */
	matched: boolean;
	/** Migration war bereits als angewendet markiert — No-op. */
	alreadyApplied: boolean;
	/** Alter Roh-Baseline vor Reset (nur bei matched). */
	previousRawEnergyBaselineKwh: number | null;
};

/**
 * Einmal-Reset nur für die Tauchpumpe nach Wh→kWh-Alias-Korrektur.
 * Entfernt den Slot komplett — nächstes Sample initialisiert neu mit initial_energy_kwh.
 *
 * Marker wird nur gesetzt, wenn:
 * - Slot gefunden und entfernt, oder
 * - Slot bewusst nicht vorhanden (nichts zu migrieren).
 */
export function applyTauchpumpeWhResetMigration(
	persist: MeasuredConsumersPersistV1,
): TauchpumpeWhResetResult {
	const applied = new Set(persist.migrationsApplied ?? []);
	if (applied.has(TAUCHPUMPE_WH_RESET_MIGRATION_ID)) {
		return {
			persist,
			changed: false,
			matched: false,
			alreadyApplied: true,
			previousRawEnergyBaselineKwh: null,
		};
	}

	const key = TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY;
	const nextSlots = { ...persist.slots };
	const existing = nextSlots[key];
	const matched = existing !== undefined;
	let previousRawEnergyBaselineKwh: number | null = null;
	if (matched) {
		previousRawEnergyBaselineKwh =
			typeof existing.rawEnergyBaselineKwh === "number" && Number.isFinite(existing.rawEnergyBaselineKwh)
				? existing.rawEnergyBaselineKwh
				: null;
		delete nextSlots[key];
	}

	applied.add(TAUCHPUMPE_WH_RESET_MIGRATION_ID);
	return {
		persist: {
			version: 1,
			slots: nextSlots,
			migrationsApplied: [...applied],
		},
		changed: true,
		matched,
		alreadyApplied: false,
		previousRawEnergyBaselineKwh,
	};
}

/** Reiner Dateileser — ohne Migration (Migration läuft in hydrate + sofortigem Write). */
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
			return {
				version: 1,
				slots,
				migrationsApplied: Array.isArray(parsed.migrationsApplied)
					? parsed.migrationsApplied.filter((x): x is string => typeof x === "string")
					: [],
			};
		}
	} catch {
		// neu / noch keine Persistenz vorhanden
	}
	return emptyMeasuredConsumersPersist() as MeasuredConsumersPersistV1;
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

export type TauchpumpeMigrationPersistHost = {
	log?: { info?: (m: string) => void; warn?: (m: string) => void; debug?: (m: string) => void };
};

/**
 * Wendet Tauchpumpen-Migration an und schreibt bei Änderung sofort atomar.
 * Bei Write-Fehler: Marker/Reset gelten als nicht abgeschlossen (unveränderter Stand bleibt).
 */
export async function persistTauchpumpeWhResetMigrationIfNeeded(
	baseDir: string,
	current: MeasuredConsumersPersistV1,
	host?: TauchpumpeMigrationPersistHost,
): Promise<MeasuredConsumersPersistV1> {
	const result = applyTauchpumpeWhResetMigration(current);
	if (!result.changed) {
		return result.persist;
	}
	try {
		await writeMeasuredConsumersPersist(baseDir, result.persist);
	} catch (e) {
		host?.log?.warn?.(
			`measured_consumers migration ${TAUCHPUMPE_WH_RESET_MIGRATION_ID} write failed — not marked applied: ${e instanceof Error ? e.message : String(e)}`,
		);
		return current;
	}
	if (result.matched) {
		const prev =
			result.previousRawEnergyBaselineKwh != null
				? ` (previous rawEnergyBaselineKwh=${result.previousRawEnergyBaselineKwh})`
				: "";
		host?.log?.info?.(
			`Measured Consumers migration ${TAUCHPUMPE_WH_RESET_MIGRATION_ID} applied and persisted${prev}`,
		);
	} else {
		host?.log?.info?.(
			`Measured Consumers migration ${TAUCHPUMPE_WH_RESET_MIGRATION_ID} marked applied (no target slot) and persisted`,
		);
	}
	return result.persist;
}
