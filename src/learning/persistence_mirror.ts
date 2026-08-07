import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";

/**
 * Learning-Persistenz: Dateien unter ems-runtime sind die Quelle der Wahrheit.
 * .emsbackup (Export-Register) sichert sie für Frischinstall/Restore.
 *
 * Große JSON-Spiegel-States im Objektbaum wurden entfernt (RAM).
 * restoreLearningPersistenceFromStates bleibt für Altinstallationen mit Spiegeln.
 */
export type PersistenceMirrorHost = StateHost & {
	getAbsolutePath?: (category?: string) => string;
	log: {
		info: (msg: string) => void;
		debug?: (msg: string) => void;
		warn: (msg: string) => void;
		error: (msg: string) => void;
	};
};

interface ArtifactDef {
	key: string;
	category: string;
	fileName: string;
	nameDe: string;
}

export const LEARNING_PERSISTENCE_ARTIFACTS: readonly ArtifactDef[] = [
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
	{
		key: "power_hourly",
		category: "learning/power_rollup",
		fileName: "power_hourly_v1.json",
		nameDe: "Power-Stunden-Rollup (Backup-Spiegel)",
	},
	{
		key: "energy_daily",
		category: "learning/energy_daily_rollup",
		fileName: "energy_daily_v1.json",
		nameDe: "Energy-Tages-Rollup (Backup-Spiegel)",
	},
	{
		key: "vehicle_presence",
		category: "learning/vehicle_presence",
		fileName: "vehicle_presence_learning_v1.json",
		nameDe: "Fahrzeug-Presence-Learning (Backup-Spiegel)",
	},
] as const;

const BASE = "learning.persistence";

function mirrorStateId(key: string): string {
	return `${BASE}.${key}_json`;
}

export function learningPersistenceMirrorRelativeIds(): string[] {
	return LEARNING_PERSISTENCE_ARTIFACTS.map((a) => mirrorStateId(a.key));
}

export async function ensureLearningPersistenceStates(host: PersistenceMirrorHost): Promise<void> {
	await ensureChannel(host, BASE, "Learning-Persistenz (Status)");
	const defs: StateDef[] = [
		{
			id: `${BASE}.last_mirror`,
			common: {
				name: "Letzte Datei-Prüfung (ISO)",
				type: "string",
				role: "value.time",
				read: true,
				write: false,
			},
		},
		{
			id: `${BASE}.last_restore`,
			common: {
				name: "Letzte Wiederherstellung aus Alt-Spiegel (ISO)",
				type: "string",
				role: "value.time",
				read: true,
				write: false,
			},
		},
		{
			id: `${BASE}.files_present`,
			common: {
				name: "Anzahl vorhandener Learning-Dateien",
				type: "number",
				role: "value",
				read: true,
				write: false,
			},
		},
	];
	await ensureStates(host, defs);
}

/**
 * Leichtgewichtiger Status-Tick: zählt Dateien, schreibt keine großen JSON-States mehr.
 * Vorher: Spiegelung ganzer Learning-Dateien in den Objektbaum (RAM-Last).
 */
export async function mirrorLearningPersistenceToStates(host: PersistenceMirrorHost): Promise<void> {
	if (typeof host.getAbsolutePath !== "function") {
		return;
	}
	let present = 0;
	for (const a of LEARNING_PERSISTENCE_ARTIFACTS) {
		try {
			const filePath = path.join(host.getAbsolutePath(a.category), a.fileName);
			await fs.access(filePath);
			present++;
		} catch {
			// missing ok
		}
	}
	await host.setStateAsync(`${BASE}.files_present`, { val: present, ack: true });
	await host.setStateAsync(`${BASE}.last_mirror`, { val: new Date().toISOString(), ack: true });
}

/**
 * Fehlende Zusammenfassungs-Dateien aus Alt-Spiegel-States wiederherstellen (Upgrade-Pfad).
 */
export async function restoreLearningPersistenceFromStates(host: PersistenceMirrorHost): Promise<void> {
	if (typeof host.getAbsolutePath !== "function") {
		return;
	}
	let restored = 0;
	for (const a of LEARNING_PERSISTENCE_ARTIFACTS) {
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
			host.log.debug?.(`Learning-Persistenz: ${a.fileName} aus Alt-Spiegel wiederhergestellt`);
		} catch (e) {
			host.log.warn(`Learning-Persistenz restore ${a.key}: ${e instanceof Error ? e.message : e}`);
		}
	}
	if (restored > 0) {
		await host.setStateAsync(`${BASE}.last_restore`, { val: new Date().toISOString(), ack: true });
	}
}
