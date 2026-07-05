/**
 * Replace cmd_cleaning_mode (Odor) with SmartThings cleaning feedback mappings in admin jsonConfig.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "..", "admin", "jsonConfig.json");

const ST_BY_UNIT = {
	1: "smartthings.0.40472197-070b-26fc-f422-69cdd84d6aa8",
	2: "smartthings.0.e03855e7-4dc4-bad7-c8c8-1b7dd0293381",
};

function feedbackFields(prefix, unitIndex) {
	const st = ST_BY_UNIT[unitIndex];
	const stateDefault = st ? `${st}.status.custom.autoCleaningMode.operatingState.value` : "";
	const modeDefault = st ? `${st}.status.custom.autoCleaningMode.autoCleaningMode.value` : "";
	const progressDefault = st ? `${st}.status.custom.autoCleaningMode.progress.value` : "";
	return {
		[`${prefix}feedback_cleaning_state_enabled`]: {
			type: "checkbox",
			label: "Rückmeldung Reinigung operatingState aktiv",
			default: Boolean(st),
			xs: 12,
			sm: 4,
			md: 3,
			lg: 3,
			xl: 3,
		},
		[`${prefix}feedback_cleaning_state_target`]: {
			type: "objectId",
			label: "Rückmeldung Reinigung operatingState State-ID",
			types: ["state"],
			default: stateDefault,
			xs: 12,
			sm: 8,
			md: 9,
			lg: 9,
			xl: 9,
		},
		[`${prefix}feedback_cleaning_mode_enabled`]: {
			type: "checkbox",
			label: "Rückmeldung Reinigung autoCleaningMode aktiv",
			default: Boolean(st),
			xs: 12,
			sm: 4,
			md: 3,
			lg: 3,
			xl: 3,
		},
		[`${prefix}feedback_cleaning_mode_target`]: {
			type: "objectId",
			label: "Rückmeldung Reinigung autoCleaningMode State-ID",
			types: ["state"],
			default: modeDefault,
			xs: 12,
			sm: 8,
			md: 9,
			lg: 9,
			xl: 9,
		},
		[`${prefix}feedback_cleaning_progress_enabled`]: {
			type: "checkbox",
			label: "Rückmeldung Reinigung Fortschritt aktiv",
			default: Boolean(st),
			xs: 12,
			sm: 4,
			md: 3,
			lg: 3,
			xl: 3,
		},
		[`${prefix}feedback_cleaning_progress_target`]: {
			type: "objectId",
			label: "Rückmeldung Reinigung Fortschritt State-ID",
			types: ["state"],
			default: progressDefault,
			xs: 12,
			sm: 8,
			md: 9,
			lg: 9,
			xl: 9,
		},
	};
}

function unitIndexFromKey(key) {
	const m = /^ac_u(\d+)_/.exec(key);
	return m ? parseInt(m[1], 10) : 0;
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const oldItems = config.items.climateTab.items;
const newItems = {};

for (const key of Object.keys(oldItems)) {
	if (/_cmd_cleaning_mode_/.test(key)) {
		continue;
	}
	newItems[key] = oldItems[key];
	if (/_cmd_cleaning_start_target$/.test(key)) {
		const m = /^ac_u(\d+)_/.exec(key);
		const unitIndex = m ? parseInt(m[1], 10) : 0;
		const prefix = key.replace(/cmd_cleaning_start_target$/, "");
		Object.assign(newItems, feedbackFields(prefix, unitIndex));
	}
	if (/_cleaning_duration_min$/.test(key)) {
		newItems[key] = {
			...oldItems[key],
			label: "Reinigung Timeout (min)",
			help: "Fallback wenn SmartThings-Feedback ausbleibt. Ende normalerweise über operatingState=ready.",
			default: unitIndexFromKey(key) === 1 ? 35 : 45,
		};
	}
}

config.items.climateTab.items = newItems;
fs.writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`, "utf8");
console.log("Patched admin jsonConfig: cleaning feedback mappings, removed odor cmd_cleaning_mode");
