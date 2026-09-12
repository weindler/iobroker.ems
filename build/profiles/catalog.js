"use strict";
/** Herstellerübergreifender, read-only Gerätekatalog für Setup/UI/App. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDeviceTemplateCatalog = void 0;
const registry_1 = require("../addons/air_conditioning/profiles/registry");
const registry_2 = require("../addons/battery/profiles/registry");
const CLASS_LABELS = {
    battery: "Batterie",
    wallbox: "Wallbox",
    climate: "Klima",
    immersion_heater: "Heizstab / Wärme",
};
function hierarchy(entries) {
    const classes = new Map();
    for (const entry of entries) {
        let manufacturers = classes.get(entry.deviceClass);
        if (!manufacturers) {
            manufacturers = new Map();
            classes.set(entry.deviceClass, manufacturers);
        }
        let manufacturer = manufacturers.get(entry.manufacturerId);
        if (!manufacturer) {
            manufacturer = {
                manufacturerId: entry.manufacturerId,
                manufacturer: entry.manufacturer,
                templates: [],
            };
            manufacturers.set(entry.manufacturerId, manufacturer);
        }
        manufacturer.templates.push({
            templateId: entry.templateId,
            displayNameDe: entry.displayNameDe,
            genericFallback: entry.setup.genericFallback,
            liveControl: entry.liveControl,
        });
    }
    return [...classes.entries()]
        .map(([deviceClass, manufacturers]) => ({
        deviceClass,
        labelDe: CLASS_LABELS[deviceClass],
        manufacturers: [...manufacturers.values()]
            .map((manufacturer) => ({
            ...manufacturer,
            templates: manufacturer.templates.sort((a, b) => a.templateId.localeCompare(b.templateId)),
        }))
            .sort((a, b) => a.manufacturerId.localeCompare(b.manufacturerId)),
    }))
        .sort((a, b) => a.deviceClass.localeCompare(b.deviceClass));
}
function buildDeviceTemplateCatalog() {
    const entries = [];
    for (const profile of registry_2.BATTERY_PROFILES) {
        entries.push({
            deviceClass: "battery",
            manufacturerId: profile.catalog.manufacturerId,
            manufacturer: profile.catalog.manufacturerNameDe,
            templateId: profile.id,
            displayNameDe: profile.displayNameDe,
            templateKind: profile.catalog.templateKind,
            integration: profile.catalog.integration,
            availability: "implemented",
            capabilities: [
                ...(profile.supportsRead ? ["telemetry", "soc", "power", "capacity"] : []),
                ...(profile.plannerCapabilities.chargeDispatch ? ["charge_control"] : []),
                ...(profile.plannerCapabilities.activeDischargeDispatch ? ["discharge_control"] : []),
                ...(profile.plannerCapabilities.gridBalanceControl ? ["grid_balance"] : []),
            ],
            liveControl: profile.supportsLive,
            executionAuthority: profile.supportsLive ? "ems" : "read_only",
            plannerContract: "normalized_contribution_v1",
            setup: {
                kind: profile.catalog.setupKind,
                genericFallback: profile.catalog.genericFallback,
                manualMappingAvailable: profile.catalog.manualMappingAvailable,
                hintDe: profile.catalog.setupHintDe,
                requiredReadRoles: [...profile.requiredReadRoles],
                requiredWriteRoles: [...profile.requiredWriteRoles],
            },
        });
    }
    for (const profile of registry_1.AC_PROFILES) {
        entries.push({
            deviceClass: "climate",
            manufacturerId: profile.catalog.manufacturerId,
            manufacturer: profile.catalog.manufacturerNameDe,
            templateId: profile.id,
            displayNameDe: profile.displayNameDe,
            templateKind: profile.catalog.templateKind,
            integration: profile.catalog.integration,
            availability: "implemented",
            capabilities: [
                "telemetry",
                "temperature",
                "humidity",
                "cooling",
                "heating",
                "dehumidify",
                "hard_off",
                "cleaning",
                "shared_power",
            ],
            liveControl: true,
            executionAuthority: "ems",
            plannerContract: "normalized_contribution_v1",
            setup: {
                kind: profile.catalog.setupKind,
                genericFallback: profile.catalog.genericFallback,
                manualMappingAvailable: profile.catalog.manualMappingAvailable,
                hintDe: profile.catalog.setupHintDe,
            },
        });
    }
    entries.push({
        deviceClass: "wallbox",
        manufacturerId: "evcc",
        manufacturer: "EVCC",
        templateId: "evcc_generic",
        displayNameDe: "EVCC (herstellerübergreifend)",
        templateKind: "generic",
        integration: "evcc",
        availability: "implemented",
        capabilities: [
            "telemetry",
            "presence",
            "vehicle_soc",
            "target_soc",
            "remaining_energy",
            "charge_mode",
            "charge_current",
        ],
        liveControl: true,
        executionAuthority: "external",
        plannerContract: "normalized_contribution_v1",
        setup: {
            kind: "adapter_instance",
            genericFallback: true,
            manualMappingAvailable: true,
            hintDe: "Vorhandene EVCC-Instanz auswählen und deren normalisierte Status-/Control-Datenpunkte zuordnen.",
        },
    }, {
        deviceClass: "immersion_heater",
        manufacturerId: "generic",
        manufacturer: "Generisch",
        templateId: "generic_mapping",
        displayNameDe: "Heizstab (Mapping-basiert)",
        templateKind: "generic",
        integration: "state_mapping",
        availability: "implemented",
        capabilities: ["temperature", "staged_power", "feedback", "hygiene", "safety_lockout"],
        liveControl: true,
        executionAuthority: "ems",
        plannerContract: "normalized_contribution_v1",
        setup: {
            kind: "manual_mapping",
            genericFallback: true,
            manualMappingAvailable: true,
            hintDe: "Temperatur-, Stufen-, Feedback- und Safety-Datenpunkte manuell zuordnen.",
        },
    });
    entries.sort((a, b) => a.deviceClass.localeCompare(b.deviceClass) || a.templateId.localeCompare(b.templateId));
    return {
        schemaVersion: 1,
        generatedFrom: "compiled_profiles",
        plannerContract: "normalized_contribution_v1",
        setupFlow: {
            steps: ["device_class", "manufacturer", "template", "binding"],
            genericFallbackDe: "Unbekannte Geräte verwenden ein vorhandenes generisches Mapping beziehungsweise EVCC; LIVE bleibt von Profil-, Mapping- und Safety-Readiness abhängig.",
        },
        entries,
        classes: hierarchy(entries),
    };
}
exports.buildDeviceTemplateCatalog = buildDeviceTemplateCatalog;
