/**
 * Admin-UI-Generator für den Klima-Tab (5× identische Innengerät-Blöcke).
 *
 * Statt 5 fast identische Blöcke von Hand in admin/jsonConfig.json zu pflegen
 * (Block 3 des Aufräum-Fahrplans, s. docs/README.md), wird jeder Block aus
 * `climate_unit_shape.ts` (Struktur, für alle 5 Geräte identisch) plus
 * `climate_unit_defaults.ts` (individuelle Default-Werte je Gerät) erzeugt.
 *
 * Nutzung:
 *   npm run admin-config:generate   — schreibt admin/jsonConfig.json neu
 *   npm run admin-config:check      — prüft nur, ob die Datei dem Template
 *                                      entspricht (Exit-Code 1 bei Drift,
 *                                      Teil von `npm test` / CI)
 *
 * Alles außerhalb des Klima-Tabs (andere Tabs) sowie die 6 globalen Klima-Felder
 * (introAc, climateGovernanceHint, ac_addon_mode, ac_outdoor_max_power_w,
 * ac_planner_outdoor_likely_temp_c, ac_default_profile) bleiben unverändert.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { CLIMATE_UNIT_SHAPE } from "./climate_unit_shape";
import { CLIMATE_UNIT_DEFAULTS } from "./climate_unit_defaults";

const CLIMATE_UNIT_COUNT = 5;
const GLOBAL_CLIMATE_KEYS = [
	"introAc",
	"climateGovernanceHint",
	"ac_addon_mode",
	"ac_outdoor_max_power_w",
	"ac_planner_outdoor_likely_temp_c",
	"ac_default_profile",
];

function isOverrideMarker(value: unknown): value is { __override__: string } {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		typeof (value as Record<string, unknown>).__override__ === "string"
	);
}

/**
 * Fällt der individuelle Default-Wert für ein noch unkonfiguriertes Gerät (3-5) auf
 * null/undefined, wird das Feld ganz weggelassen — analog zum bisherigen Datenstand,
 * wo unkonfigurierte Geräte gar kein "default" fürs jeweilige Feld hatten.
 */
function fillTemplateValue(value: unknown, unitNumber: number, overrides: Record<string, unknown>): unknown {
	if (typeof value === "string") {
		return value.replace(/\{N\}/g, String(unitNumber));
	}
	if (Array.isArray(value)) {
		return value.map((v) => fillTemplateValue(v, unitNumber, overrides));
	}
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (isOverrideMarker(v)) {
				const suffix = v.__override__;
				if (!(suffix in overrides)) {
					throw new Error(`admin_config generator: missing override "${suffix}" in climate_unit_defaults.ts`);
				}
				const overrideValue = overrides[suffix];
				if (overrideValue === null || overrideValue === undefined) continue;
				out[k] = overrideValue;
				continue;
			}
			out[k] = fillTemplateValue(v, unitNumber, overrides);
		}
		return out;
	}
	return value;
}

export function buildClimateUnitItems(unitNumber: number): Array<[string, unknown]> {
	const overrides = CLIMATE_UNIT_DEFAULTS[String(unitNumber)];
	if (!overrides) {
		throw new Error(`admin_config generator: no defaults for unit ${unitNumber}`);
	}
	return CLIMATE_UNIT_SHAPE.map(([templatedKey, templatedValue]) => {
		const key = templatedKey.replace(/\{N\}/g, String(unitNumber));
		const value = fillTemplateValue(templatedValue, unitNumber, overrides);
		return [key, value] as [string, unknown];
	});
}

export function buildClimateTabItems(existingItems: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of GLOBAL_CLIMATE_KEYS) {
		if (!(key in existingItems)) {
			throw new Error(`admin_config generator: expected global climate key "${key}" missing in jsonConfig.json`);
		}
		out[key] = existingItems[key];
	}
	for (let unit = 1; unit <= CLIMATE_UNIT_COUNT; unit++) {
		for (const [key, value] of buildClimateUnitItems(unit)) {
			out[key] = value;
		}
	}
	return out;
}

function jsonConfigPath(): string {
	// Läuft aus build/tools/admin_config/generate.js — Repo-Root ist vier Ebenen höher.
	return path.resolve(__dirname, "..", "..", "..", "admin", "jsonConfig.json");
}

/**
 * Findet das schließende "}" zum "{" bei openIdx (stringsicher, respektiert Escapes).
 * Der Rest der Datei (andere Tabs, Formatierung) bleibt dadurch komplett unberührt —
 * es wird NICHT die gesamte Datei neu serialisiert, sondern nur der Klima-Items-Block
 * textuell ersetzt.
 */
function findMatchingBrace(text: string, openIdx: number): number {
	let depth = 0;
	let inString = false;
	for (let i = openIdx; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (c === "\\") {
				i++;
				continue;
			}
			if (c === '"') inString = false;
			continue;
		}
		if (c === '"') {
			inString = true;
			continue;
		}
		if (c === "{") depth++;
		else if (c === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	throw new Error(`admin_config generator: unbalanced braces from index ${openIdx}`);
}

function findObjectValueSpan(text: string, keyLiteral: string, fromIndex: number): { openIdx: number; closeIdx: number } {
	const keyIdx = text.indexOf(keyLiteral, fromIndex);
	if (keyIdx === -1) throw new Error(`admin_config generator: key ${keyLiteral} not found`);
	const colonIdx = text.indexOf(":", keyIdx + keyLiteral.length);
	const openIdx = text.indexOf("{", colonIdx);
	const closeIdx = findMatchingBrace(text, openIdx);
	return { openIdx, closeIdx };
}

function main(): void {
	const checkOnly = process.argv.includes("--check");
	const filePath = jsonConfigPath();
	const raw = fs.readFileSync(filePath, "utf8");
	const cfg = JSON.parse(raw) as { items: Record<string, { items: Record<string, unknown> }> };
	const climateTab = cfg.items.climateTab;
	if (!climateTab || typeof climateTab.items !== "object") {
		throw new Error("admin_config generator: climateTab.items not found in jsonConfig.json");
	}

	const generatedClimateItems = buildClimateTabItems(climateTab.items);
	const bodyJson = JSON.stringify(generatedClimateItems, null, "\t");
	const reindented = bodyJson
		.split("\n")
		.map((line, idx) => (idx === 0 ? line : `\t\t\t${line}`))
		.join("\n");

	const climateTabSpan = findObjectValueSpan(raw, '"climateTab"', 0);
	const itemsSpan = findObjectValueSpan(raw, '"items"', climateTabSpan.openIdx);
	if (itemsSpan.closeIdx > climateTabSpan.closeIdx) {
		throw new Error("admin_config generator: climateTab.items span exceeds climateTab span — aborting");
	}
	const generatedRaw = raw.slice(0, itemsSpan.openIdx) + reindented + raw.slice(itemsSpan.closeIdx + 1);

	if (checkOnly) {
		if (generatedRaw !== raw) {
			process.stderr.write(
				"admin_config check: admin/jsonConfig.json (Klima-Tab) ist nicht mehr aus dem Template generiert.\n" +
					"Manuelle Änderungen an ac_u<N>_*/hAcU<N>* bitte in climate_unit_shape.ts bzw.\n" +
					"climate_unit_defaults.ts vornehmen und dann `npm run admin-config:generate` ausführen.\n",
			);
			process.exitCode = 1;
			return;
		}
		process.stdout.write("admin_config check: OK — Klima-Tab entspricht dem Template.\n");
		return;
	}

	fs.writeFileSync(filePath, generatedRaw, "utf8");
	process.stdout.write(`admin_config generate: admin/jsonConfig.json aktualisiert (${filePath}).\n`);
}

if (require.main === module) {
	main();
}
