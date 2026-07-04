/**
 * 1) Flatten nested EMS-Light tabs (ioBroker admin does not render tabs inside panels).
 * 2) Apply SmartThings mapping defaults for AC unit 1 (Wohnzimmer) and unit 2 (Josef OG).
 * 3) Test phase: unit 1 off, unit 2 on by default.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "..", "admin", "jsonConfig.json");

const ST_WZ = "smartthings.0.40472197-070b-26fc-f422-69cdd84d6aa8";
const ST_JOSEF = "smartthings.0.e03855e7-4dc4-bad7-c8c8-1b7dd0293381";

const AC_U1_DEFAULTS = {
	ac_u1_enabled: false,
	ac_u1_room_temp_target: "alias.0.Wohnzimmer_EG.Sensoren.Temp_Feucht.Temperatur",
	ac_u1_room_humidity_target: "alias.0.Wohnzimmer_EG.Sensoren.Temp_Feucht.Luftfeuchtigkeit",
	ac_u1_feedback_switch_target: `${ST_WZ}.status.switch.switch.value`,
	ac_u1_feedback_mode_target: `${ST_WZ}.status.airConditionerMode.airConditionerMode.value`,
	ac_u1_cmd_switch_on_target: `${ST_WZ}.capabilities.switch-on`,
	ac_u1_cmd_switch_off_target: `${ST_WZ}.capabilities.switch-off`,
	ac_u1_cmd_set_mode_target: `${ST_WZ}.capabilities.airConditionerMode-setAirConditionerMode`,
	ac_u1_cmd_set_fan_mode_target: `${ST_WZ}.capabilities.airConditionerFanMode-setFanMode`,
	ac_u1_cmd_set_cool_setpoint_target: `${ST_WZ}.capabilities.thermostatCoolingSetpoint-setCoolingSetpoint`,
	ac_u1_cmd_cleaning_start_target: `${ST_WZ}.capabilities.custom.autoCleaningMode-setAutoCleaningMode`,
	ac_u1_cmd_cleaning_mode_target: `${ST_WZ}.capabilities.custom.airConditionerOdorController-setAirConditionerOdorControllerState`,
	ac_u1_cmd_refresh_target: `${ST_WZ}.capabilities.refresh-refresh`,
};

const AC_U2_DEFAULTS = {
	ac_u2_enabled: true,
	ac_u2_room_temp_target: "alias.0.Josef_Zimmer_OG.Sensoren.Temp_Feucht.Temperatur",
	ac_u2_room_humidity_target: "alias.0.Josef_Zimmer_OG.Sensoren.Temp_Feucht.Luftfeuchtigkeit",
	ac_u2_feedback_switch_target: `${ST_JOSEF}.status.switch.switch.value`,
	ac_u2_feedback_mode_target: `${ST_JOSEF}.status.airConditionerMode.airConditionerMode.value`,
	ac_u2_cmd_switch_on_target: `${ST_JOSEF}.capabilities.switch-on`,
	ac_u2_cmd_switch_off_target: `${ST_JOSEF}.capabilities.switch-off`,
	ac_u2_cmd_set_mode_target: `${ST_JOSEF}.capabilities.airConditionerMode-setAirConditionerMode`,
	ac_u2_cmd_set_fan_mode_target: `${ST_JOSEF}.capabilities.airConditionerFanMode-setFanMode`,
	ac_u2_cmd_set_cool_setpoint_target: `${ST_JOSEF}.capabilities.thermostatCoolingSetpoint-setCoolingSetpoint`,
	ac_u2_cmd_cleaning_start_target: `${ST_JOSEF}.capabilities.custom.autoCleaningMode-setAutoCleaningMode`,
	ac_u2_cmd_cleaning_mode_target: `${ST_JOSEF}.capabilities.custom.airConditionerOdorController-setAirConditionerOdorControllerState`,
	ac_u2_cmd_refresh_target: `${ST_JOSEF}.capabilities.refresh-refresh`,
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

function applyAcDefaults(panelItems, defaults) {
	for (const [key, value] of Object.entries(defaults)) {
		if (!panelItems[key] || typeof panelItems[key] !== "object") {
			continue;
		}
		if (key.endsWith("_enabled") && typeof value === "boolean") {
			panelItems[key].default = value;
		} else if (key.endsWith("_target")) {
			panelItems[key].default = value;
		}
	}
}

applyAcDefaults(config.items.climateTab.items, AC_U1_DEFAULTS);
applyAcDefaults(config.items.climateTab.items, AC_U2_DEFAULTS);

if (config.items.climateTab.items.ac_u1_room_humidity_enabled) {
	config.items.climateTab.items.ac_u1_room_humidity_enabled.default = true;
}
if (config.items.climateTab.items.ac_u2_room_humidity_enabled) {
	config.items.climateTab.items.ac_u2_room_humidity_enabled.default = true;
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`);
console.log("Top-level tabs:", Object.keys(config.items).join(", "));
console.log("AC unit 1: disabled (Wohnzimmer mapping kept)");
console.log("AC unit 2: enabled + Josef OG SmartThings mapping defaults");
