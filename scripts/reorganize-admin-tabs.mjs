/**
 * Reorganize admin top-level tabs:
 * - Move Klima right after Heizstab (visible without horizontal overflow)
 * - Nest EMS-Light Learning / Policy / Intent under one "EMS-Light" tab
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "..", "admin", "jsonConfig.json");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const items = config.items;

const {
	globalTab,
	wallboxTab,
	batteryTab,
	immersionHeaterTab,
	dynamicTariffTab,
	emsLightLearningTab,
	emsLightPolicyTab,
	emsLightIntentTab,
	climateTab,
	...rest
} = items;

if (Object.keys(rest).length > 0) {
	console.warn("Unexpected extra tabs:", Object.keys(rest));
}

climateTab.label = "Klima";
emsLightLearningTab.label = "Learning";
emsLightPolicyTab.label = "Policy";
emsLightIntentTab.label = "Intent";

const emsLightTab = {
	type: "panel",
	label: "EMS-Light",
	items: {
		emsLightInnerTabs: {
			type: "tabs",
			items: {
				emsLightLearningTab,
				emsLightPolicyTab,
				emsLightIntentTab,
			},
		},
	},
};

config.items = {
	globalTab,
	wallboxTab,
	batteryTab,
	immersionHeaterTab,
	climateTab,
	dynamicTariffTab,
	emsLightTab,
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`);
console.log("Reorganized admin tabs:", Object.keys(config.items).join(", "));
