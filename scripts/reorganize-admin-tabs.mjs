/**
 * Reorganize admin top-level tabs:
 * - Klima right after Heizstab
 * - EMS-Light as flat tabs (nested tabs are not rendered by ioBroker admin)
 * - Shorter labels to reduce horizontal overflow
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "..", "admin", "jsonConfig.json");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const items = config.items;

function extractEmsLightTabs(source) {
	if (source.emsLightTab?.items?.emsLightInnerTabs?.items) {
		const inner = source.emsLightTab.items.emsLightInnerTabs.items;
		return {
			emsLightLearningTab: inner.emsLightLearningTab,
			emsLightPolicyTab: inner.emsLightPolicyTab,
			emsLightIntentTab: inner.emsLightIntentTab,
		};
	}
	return {
		emsLightLearningTab: source.emsLightLearningTab,
		emsLightPolicyTab: source.emsLightPolicyTab,
		emsLightIntentTab: source.emsLightIntentTab,
	};
}

const {
	globalTab,
	wallboxTab,
	batteryTab,
	immersionHeaterTab,
	dynamicTariffTab,
	climateTab,
	emsLightTab,
	...rest
} = items;

const { emsLightLearningTab, emsLightPolicyTab, emsLightIntentTab } = extractEmsLightTabs(items);

if (Object.keys(rest).length > 0) {
	console.warn("Unexpected extra tabs:", Object.keys(rest));
}

if (climateTab) climateTab.label = "Klima";
if (dynamicTariffTab) dynamicTariffTab.label = "Tarif";
emsLightLearningTab.label = "Learning";
emsLightPolicyTab.label = "Policy";
emsLightIntentTab.label = "Intent";

config.items = {
	globalTab,
	wallboxTab,
	batteryTab,
	immersionHeaterTab,
	climateTab,
	dynamicTariffTab,
	emsLightLearningTab,
	emsLightPolicyTab,
	emsLightIntentTab,
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`);
console.log("Reorganized admin tabs:", Object.keys(config.items).join(", "));
