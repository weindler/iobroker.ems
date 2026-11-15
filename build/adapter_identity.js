"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtimeDirName = exports.durableDirName = exports.LEGACY_ADAPTER_NAME = exports.ADAPTER_NAME = void 0;
exports.isKnownAdapterName = isKnownAdapterName;
exports.isKnownNamespace = isKnownNamespace;
/**
 * Name des Adapters an einer Stelle. Der Adapter hieß bis 0.4.90 `ems` (Instanz `ems.0`) und heißt ab
 * 0.4.91 `ems-light` (Instanz `ems-light.0`). Alte Backups (Manifest-Name `ems`) bleiben wiederherstellbar.
 */
exports.ADAPTER_NAME = "ems-light";
exports.LEGACY_ADAPTER_NAME = "ems";
/** Ordner im ioBroker-Datenverzeichnis: dauerhafte Daten und Laufzeitdaten je Instanz. */
const durableDirName = (instance) => `${exports.ADAPTER_NAME}.${instance}`;
exports.durableDirName = durableDirName;
const runtimeDirName = (instance) => `${exports.ADAPTER_NAME}-runtime.${instance}`;
exports.runtimeDirName = runtimeDirName;
function isKnownAdapterName(name) {
    return name === exports.ADAPTER_NAME || name === exports.LEGACY_ADAPTER_NAME;
}
/** Namespace dieser oder der früheren Adapter-Version, z. B. `ems-light.0` oder `ems.0`. */
function isKnownNamespace(ns) {
    return typeof ns === "string" && (ns.startsWith(`${exports.ADAPTER_NAME}.`) || ns.startsWith(`${exports.LEGACY_ADAPTER_NAME}.`));
}
