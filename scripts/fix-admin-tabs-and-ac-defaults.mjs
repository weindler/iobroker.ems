/**
 * 1) Flatten nested EMS-Light tabs (ioBroker admin does not render tabs inside panels).
 * 2) Apply Wohnzimmer EG SmartThings mapping defaults for AC unit 1.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "..", "admin", "jsonConfig.json");

const ST = "smartthings.0.40472197-070b-26fc-f422-69cdd84d6aa8";

const AC_U1_DEFAULTS = {
	ac_u1_room_temp_target: "alias.0.Wohnzimmer_EG.Sensoren.Temp_Feucht.Temperatur",
	ac_u1_room_humidity_target: "alias.0.Wohnzimmer_EG.Sensoren.Temp_Feucht.Luftfeuchtigkeit",
	ac_u1_feedback_switch_target: `${ST}.status.switch.switch.value`,
	ac_u1_feedback_mode_target: `${ST}.status.airConditionerMode.airConditionerMode.value`,
	ac_u1_cmd_switch_on_target: `${ST}.capabilities.switch-on`,
	ac_u1_cmd_switch_off_target: `${ST}.capabilities.switch-off`,
	ac_u1_cmd_set_mode_target: `${ST}.capabilities.airConditionerMode-setAirConditionerMode`,
	ac_u1_cmd_set_fan_mode_target: `${ST}.capabilities.airConditionerFanMode-setFanMode`,
	ac_u1_cmd_set_cool_setpoint_target: `${ST}.capabilities.thermostatCoolingSetpoint-setCoolingSetpoint`,
	ac_u1_cmd_cleaning_start_target: `${ST}.capabilities.custom.autoCleaningMode-setAutoCleaningMode`,
	ac_u1_cmd_cleaning_mode_target: `${ST}.capabilities.custom.airConditionerOdorController-setAirConditionerOdorControllerState`,
	ac_u1_cmd_refresh_target: `${ST}.capabilities.refresh-refresh`,
};

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const items = config.items;

let emsLightLearningTab;
let emsLightPolicyTab;
let emsLightIntentTab;

if (items.emsLightTab?.items?.emsLightInnerTabs?.items) {
	const inner = items.emsLightTab.items.emsLightInnerTabs.items;
	emsLightLearningTab = inner.emsLightLearningTab;
	emsLightPolicyTab = inner.emsLightPolicyTab;
	emsLightIntentTab = inner.emsLightIntentTab;
	delete items.emsLightTab;
} else {
	emsLightLearningTab = items.emsLightLearningTab;
	emsLightPolicyTab = items.emsLightPolicyTab;
	emsLightIntentTab = items.emsLightIntentTab;
}

if (!emsLightLearningTab || !emsLightPolicyTab || !emsLightIntentTab) {
	throw new Error("EMS-Light sub-tabs not found in jsonConfig");
}

emsLightLearningTab.label = "Learning";
emsLightPolicyTab.label = "Policy";
emsLightIntentTab.label = "Intent";

const {
	globalTab,
	wallboxTab,
	batteryTab,
	immersionHeaterTab,
	climateTab,
	dynamicTariffTab,
	...rest
} = items;

if (climateTab) {
	climateTab.label = "Klima";
}
if (dynamicTariffTab) {
	dynamicTariffTab.label = "Tarif";
}

if (Object.keys(rest).length > 0) {
	console.warn("Extra tabs (ignored in reorder):", Object.keys(rest));
}

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

function applyAcDefaults(panelItems) {
	for (const [key, value] of Object.entries(AC_U1_DEFAULTS)) {
		if (panelItems[key] && typeof panelItems[key] === "object") {
			panelItems[key].default = value;
		}
	}
	if (panelItems.ac_u1_room_humidity_enabled) {
		panelItems.ac_u1_room_humidity_enabled.default = true;
	}
}

applyAcDefaults(config.items.climateTab.items);

fs.writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`);
console.log("Top-level tabs:", Object.keys(config.items).join(", "));
console.log("AC unit 1 mapping defaults applied for Wohnzimmer EG");
