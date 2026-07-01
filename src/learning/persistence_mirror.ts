import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";

/**
 * Backup-Spiegel für die Learning-Zusammenfassungen.
 *
 * Hintergrund: Die gelernten Zusammenfassungen liegen als JSON-Dateien im
 * Instanz-Datenordner (`getAbsoluteInstanceDataDir`). Dieser Ordner wird beim
 * Löschen der Adapter-Instanz entfernt. Damit die Zusammenfassungen in einem
 * ioBroker-Backup (Objekte + States) enthalten sind und nach Verlust der Datei
 * wiederhergestellt werden können, werden sie zusätzlich als JSON-State im
 * Objektbaum gespiegelt.
 *
 * Die Roh-Historie der Quell-Datenpunkte (history.0) bleibt die eigentliche
 * Quelle; dieser Spiegel ist eine zusätzliche Absicherung.
 */
export type PersistenceMirrorHost = StateHost & {
	getAbsolutePath?: (category?: string) => string;
	log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
};

interface ArtifactDef {
	/** Suffix des Spiegel-States. */
	key: string;
	/** Relativer Ordner unter dem Instanz-Datenordner. */
	category: string;
	/** Dateiname der Zusammenfassung. */
	fileName: string;
	nameDe: string;
}

const ARTIFACTS: readonly ArtifactDef[] = [
	{
		key: "battery_runtime",
		category: "learning/battery_runtime",
		fileName: "battery_runtime_learning_v1.json",
		nameDe: "Battery-Runtime-Learning (Backup-Spiegel)",
	},
	{
		key: "house_load",
		category: "learning/house_load",
		fileName: "house_load_learning_v1.json",
		nameDe: "Hauslast-Learning (Backup-Spiegel)",
	},
	{
		key: "thermal_runtime",
		category: "learning/thermal_runtime",
		fileName: "thermal_runtime_learning_v1.json",
		nameDe: "Thermal-Runtime-Learning (Backup-Spiegel)",
	},
	{
		key: "price_learning",
		category: "learning/price_learning",
		fileName: "price_learning_v1.json",
		nameDe: "Preis-Learning (Backup-Spiegel)",
	},
	{
		key: "price_forecast",
		category: "learning/price_forecast",
		fileName: "price_forecast_learning_v1.json",
		nameDe: "Preis-Forecast-Learning (Backup-Spiegel)",
	},
	{
		key: "pv_bias_daily",
		category: "learning/pv_bias",
		fileName: "pv_bias_daily_v1.json",
		nameDe: "PV-Bias Tages-Snapshots (Backup-Spiegel)",
	},
] as const;

const BASE = "learning.persistence";

function mirrorStateId(key: string): string {
	return `${BASE}.${key}_json`;
}

export async function ensureLearningPersistenceStates(host: PersistenceMirrorHost): Promise<void> {
	await ensureChannel(host, BASE, "Learning-Persistenz (Backup-Spiegel)");
	const defs: StateDef[] = ARTIFACTS.map((a) => ({
		id: mirrorStateId(a.key),
		common: {
			name: a.nameDe,
			type: "string",
			role: "json",
			read: true,
			write: false,
		},
	}));
	defs.push(
		{
			id: `${BASE}.last_mirror`,
			common: { name: "Letzte Spiegelung", type: "string", role: "value.time", read: true, write: false },
		},
		{
			id: `${BASE}.last_restore`,
			common: { name: "Letzte Wiederherstellung", type: "string", role: "value.time", read: true, write: false },
		},
	);
	await ensureStates(host, defs);
}

/** Datei-Zusammenfassungen in die Spiegel-States schreiben (ack=true). */
export async function mirrorLearningPersistenceToStates(host: PersistenceMirrorHost): Promise<void> {
	if (typeof host.getAbsolutePath !== "function") {
		return;
	}
	let mirrored = 0;
	for (const a of ARTIFACTS) {
		try {
			const filePath = path.join(host.getAbsolutePath(a.category), a.fileName);
			const raw = await fs.readFile(filePath, "utf8");
			await host.setStateAsync(mirrorStateId(a.key), { val: raw, ack: true });
			mirrored++;
		} catch {
			// Datei existiert (noch) nicht — vorhandenen Spiegel-State unangetastet lassen.
		}
	}
	if (mirrored > 0) {
		await host.setStateAsync(`${BASE}.last_mirror`, { val: new Date().toISOString(), ack: true });
	}
}

/**
 * Fehlende Zusammenfassungs-Dateien aus den Spiegel-States wiederherstellen.
 * Nur schreiben, wenn die Datei fehlt und der State gültiges JSON enthält.
 */
export async function restoreLearningPersistenceFromStates(host: PersistenceMirrorHost): Promise<void> {
	if (typeof host.getAbsolutePath !== "function") {
		return;
	}
	let restored = 0;
	for (const a of ARTIFACTS) {
		try {
			const dir = host.getAbsolutePath(a.category);
			const filePath = path.join(dir, a.fileName);
			let fileExists = true;
			try {
				await fs.access(filePath);
			} catch {
				fileExists = false;
			}
			if (fileExists) {
				continue;
			}
			const st = await host.getStateAsync(mirrorStateId(a.key));
			const val = st?.val;
			if (typeof val !== "string" || val.trim() === "") {
				continue;
			}
			try {
				JSON.parse(val);
			} catch {
				continue;
			}
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(filePath, val.endsWith("\n") ? val : `${val}\n`, "utf8");
			restored++;
			host.log.info(`Learning-Persistenz: ${a.fileName} aus Backup-State wiederhergestellt`);
		} catch (e) {
			host.log.warn(`Learning-Persistenz restore ${a.key}: ${e instanceof Error ? e.message : e}`);
		}
	}
	if (restored > 0) {
		await host.setStateAsync(`${BASE}.last_restore`, { val: new Date().toISOString(), ack: true });
	}
}
