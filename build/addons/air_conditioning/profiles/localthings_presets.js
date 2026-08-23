"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSmartThingsTarget = exports.isHassLocalthingsTarget = exports.deriveLocalthingsMappingsFromClimateBase = exports.LOCALTHINGS_SITE_PRESETS = void 0;
const WZ = "wohnzimmer_eg_wohnzimmer_eg_klimaanlage";
const JOSEF = "josef_zimmer_josef_klimaanlage";
function climateMaps(entity) {
    const c = `hass.0.entities.climate.${entity}`;
    return {
        /** HVAC-Modus-String (cool/off/…) — state_boolean ist bei LocalThings oft falsch false. */
        feedback_switch: `${c}.state`,
        feedback_mode: `${c}.state`,
        feedback_setpoint: `${c}.temperature`,
        room_temp: `${c}.current_temperature`,
        cmd_switch_on: `${c}.turn_on`,
        cmd_switch_off: `${c}.turn_off`,
        cmd_set_mode: `${c}.set_hvac_mode`,
        cmd_set_cool_setpoint: `${c}.set_temperature`,
        cmd_set_heat_setpoint: `${c}.set_temperature`,
        cmd_set_fan_mode: `${c}.set_fan_mode`,
        feedback_preset_mode: `${c}.preset_mode`,
        cmd_set_preset_mode: `${c}.set_preset_mode`,
        feedback_swing_mode: `${c}.swing_mode`,
        cmd_set_swing_mode: `${c}.set_swing_mode`,
    };
}
function switchMaps(entityBase, suffix) {
    const s = `hass.0.entities.switch.${entityBase}_${suffix}`;
    return {
        status: `${s}.state_boolean`,
        on: `${s}.turn_on`,
        off: `${s}.turn_off`,
    };
}
function extrasFor(entityBase, opts) {
    const clean = switchMaps(entityBase, "automatische_reinigung");
    const display = switchMaps(entityBase, "displaybeleuchtung");
    const sound = switchMaps(entityBase, "signalton");
    const out = {
        ...climateMaps(entityBase),
        cmd_cleaning_start: clean.on,
        cmd_cleaning_off: clean.off,
        feedback_cleaning_mode: clean.status,
        feedback_cleaning_state: `hass.0.entities.binary_sensor.${entityBase}_automatische_reinigung_lauft.state_boolean`,
        feedback_cleaning_progress: `hass.0.entities.sensor.${entityBase}_fortschritt_automatische_reinigung.state`,
        power_w: `hass.0.entities.sensor.${entityBase}_leistung.state`,
        energy_kwh: `hass.0.entities.sensor.${entityBase}_energie.state`,
        filter_usage_pct: `hass.0.entities.sensor.${entityBase}_filternutzung.state`,
        filter_usage_hours: `hass.0.entities.sensor.${entityBase}_filternutzungsstunden.state`,
        filter_status: `hass.0.entities.sensor.${entityBase}_filterstatus.state`,
        diagnosis_status: `hass.0.entities.sensor.${entityBase}_diagnosestatus.state`,
        cmd_diagnosis_start: `hass.0.entities.button.${entityBase}_diagnose_starten.press`,
        display_light: display.status,
        cmd_display_on: display.on,
        cmd_display_off: display.off,
        sound: sound.status,
        cmd_sound_on: sound.on,
        cmd_sound_off: sound.off,
    };
    if (opts?.firmware !== false) {
        out.firmware_update = `hass.0.entities.binary_sensor.${entityBase}_firmware_update_verfugbar.state_boolean`;
    }
    if (opts?.muteOnce) {
        out.cmd_mute_once = `hass.0.entities.button.${entityBase}_einmal_stummschalten.press`;
    }
    return out;
}
exports.LOCALTHINGS_SITE_PRESETS = [
    {
        unitIndex: 1,
        nameHint: "Wohnzimmer",
        climateEntity: WZ,
        mappings: extrasFor(WZ, { firmware: true }),
    },
    {
        unitIndex: 2,
        nameHint: "Josef",
        climateEntity: JOSEF,
        mappings: extrasFor(JOSEF, { firmware: false }),
    },
];
/**
 * Leitet Standard-Climate-Mappings aus einem hass climate entity-Pfad ab.
 * Beispiel: hass.0.entities.climate.foo.bar.state → Prefix …/climate.foo.bar
 */
function deriveLocalthingsMappingsFromClimateBase(climateBaseOrStateId) {
    const raw = climateBaseOrStateId.trim();
    if (!raw.includes("hass.") || !raw.includes("climate.")) {
        return {};
    }
    const m = raw.match(/^(hass\.\d+\.entities\.climate\.[^.]+(?:\.[^.]+)*)/);
    if (!m)
        return {};
    let base = m[1];
    // Strip trailing attribute if user pasted .state / .temperature etc.
    base = base.replace(/\.(state|state_boolean|temperature|current_temperature|turn_on|turn_off|set_hvac_mode|set_temperature|fan_mode|set_fan_mode|preset_mode|set_preset_mode|swing_mode|set_swing_mode|hvac_modes|fan_modes|preset_modes|min_temp|max_temp|target_temp_step)$/, "");
    const entity = base.replace(/^hass\.\d+\.entities\.climate\./, "");
    if (!entity)
        return {};
    return climateMaps(entity);
}
exports.deriveLocalthingsMappingsFromClimateBase = deriveLocalthingsMappingsFromClimateBase;
function isHassLocalthingsTarget(stateId) {
    return stateId.trim().startsWith("hass.") && stateId.includes(".entities.");
}
exports.isHassLocalthingsTarget = isHassLocalthingsTarget;
function isSmartThingsTarget(stateId) {
    return stateId.trim().startsWith("smartthings.");
}
exports.isSmartThingsTarget = isSmartThingsTarget;
