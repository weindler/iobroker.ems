/**
 * Name des Adapters an einer Stelle. Der Adapter hieß bis 0.4.90 `ems` (Instanz `ems.0`) und heißt ab
 * 0.4.91 `ems-light` (Instanz `ems-light.0`). Alte Backups (Manifest-Name `ems`) bleiben wiederherstellbar.
 */
export const ADAPTER_NAME = "ems-light";
export const LEGACY_ADAPTER_NAME = "ems";

/** Ordner im ioBroker-Datenverzeichnis: dauerhafte Daten und Laufzeitdaten je Instanz. */
export const durableDirName = (instance: number): string => `${ADAPTER_NAME}.${instance}`;
export const runtimeDirName = (instance: number): string => `${ADAPTER_NAME}-runtime.${instance}`;

export function isKnownAdapterName(name: unknown): boolean {
	return name === ADAPTER_NAME || name === LEGACY_ADAPTER_NAME;
}

/** Namespace dieser oder der früheren Adapter-Version, z. B. `ems-light.0` oder `ems.0`. */
export function isKnownNamespace(ns: unknown): boolean {
	return typeof ns === "string" && (ns.startsWith(`${ADAPTER_NAME}.`) || ns.startsWith(`${LEGACY_ADAPTER_NAME}.`));
}
