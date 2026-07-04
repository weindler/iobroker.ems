/** Generates repetitive AC admin jsonConfig fields for units 1..5. */
const UNIT_COUNT = 5;
const roles = [
	["room_temp", "Raumtemperatur"],
	["room_humidity", "Raumfeuchte"],
	["feedback_switch", "Rückmeldung Ein/Aus"],
	["feedback_mode", "Rückmeldung Modus"],
	["cmd_switch_on", "Befehl EIN"],
	["cmd_switch_off", "Befehl AUS"],
	["cmd_set_mode", "Befehl Modus"],
	["cmd_set_fan_mode", "Befehl Lüftermodus"],
	["cmd_set_fan_speed", "Befehl Lüfterstärke"],
	["cmd_set_cool_setpoint", "Befehl Kühl-Sollwert"],
	["cmd_set_heat_setpoint", "Befehl Heiz-Sollwert"],
	["cmd_cleaning_start", "Befehl Reinigung start"],
	["cmd_cleaning_mode", "Befehl Reinigungsmodus"],
	["cmd_refresh", "Befehl Refresh"],
];

function unitFields(n) {
	const p = `ac_u${n}_`;
	const lines = [];
	lines.push(`\t\t\t\t"hAcU${n}": { "type": "header", "size": 2, "text": "Innengerät ${n}", "xs": 12, "sm": 12, "md": 12, "lg": 12, "xl": 12 }`);
	lines.push(`\t\t\t\t"${p}enabled": { "type": "checkbox", "label": "Aktiv", "default": ${n <= 2}, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}name": { "type": "text", "label": "Name", "default": ${n === 1 ? '"Wohnzimmer EG"' : n === 2 ? '"Josef Zimmer OG"' : '""'}, "xs": 12, "sm": 8, "md": 6, "lg": 6, "xl": 6 }`);
	lines.push(`\t\t\t\t"${p}profile": { "type": "select", "label": "Geräteprofil", "options": [{ "label": "Generic", "value": "generic" }, { "label": "Samsung SmartThings", "value": "samsung_smartthings" }], "default": "samsung_smartthings", "xs": 12, "sm": 6, "md": 4, "lg": 4, "xl": 4 }`);
	lines.push(`\t\t\t\t"${p}on_temp_c": { "type": "number", "label": "Einschalttemperatur (°C)", "default": ${n === 1 ? 25.5 : n === 2 ? 24.5 : 26}, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}off_temp_c": { "type": "number", "label": "Ausschalttemperatur (°C)", "default": ${n === 1 ? 24 : n === 2 ? 23 : 24}, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}max_humidity_pct": { "type": "number", "label": "Max. Feuchte (%) — optional", "help": "0 = Feuchte nur anzeigen, nicht steuern. Wert > 0: bei Überschreitung Entfeuchten (wenn Raumfeuchte gemappt).", "min": 0, "max": 100, "default": 0, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}cooling_setpoint_c": { "type": "number", "label": "Kühl-Sollwert (°C)", "default": 17, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}mode_when_cooling": { "type": "text", "label": "Modus Kühlen", "default": "cool", "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}fan_mode_when_cooling": { "type": "text", "label": "Lüftermodus Kühlen", "default": "auto", "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}fan_speed_when_cooling": { "type": "text", "label": "Lüfterstärke Kühlen (optional)", "default": "", "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}mode_when_dehumidify": { "type": "text", "label": "Modus Entfeuchten", "default": "dry", "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}fan_mode_when_dehumidify": { "type": "text", "label": "Lüftermodus Entfeuchten", "default": "auto", "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}active_from": { "type": "text", "label": "Aktiv ab (HH:MM)", "default": "08:00", "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}active_until": { "type": "text", "label": "Aktiv bis (HH:MM)", "default": "${n === 1 ? "20:00" : "19:00"}", "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}hard_off_at": { "type": "text", "label": "Hard-Off (HH:MM)", "default": "${n === 1 ? "20:00" : "19:00"}", "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}estimated_power_w": { "type": "number", "label": "Geschätzte Leistung (W)", "default": ${n === 1 ? 800 : n === 2 ? 650 : 700}, "min": 0, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}cleaning_after_run": { "type": "checkbox", "label": "Reinigung nach Lauf", "default": true, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}cleaning_delay_min": { "type": "number", "label": "Reinigung Verzögerung (min)", "default": 1, "min": 0, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}cleaning_duration_min": { "type": "number", "label": "Reinigung Dauer (min)", "default": ${n === 1 ? 35 : 30}, "min": 0, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"hAcU${n}Stats": { "type": "header", "size": 3, "text": "Statistik Innengerät ${n}", "xs": 12, "sm": 12, "md": 12, "lg": 12, "xl": 12 }`);
	lines.push(`\t\t\t\t"${p}stats_enabled": { "type": "checkbox", "label": "Statistik aktiv", "default": true, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}stats_track_runtime": { "type": "checkbox", "label": "Laufzeit mitloggen", "default": true, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}stats_track_energy": { "type": "checkbox", "label": "Verbrauch mitloggen", "default": true, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}stats_runtime_offset_h": { "type": "number", "label": "Offset Laufzeit (h)", "default": 0, "min": 0, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"${p}stats_energy_offset_kwh": { "type": "number", "label": "Offset Verbrauch (kWh)", "default": 0, "min": 0, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
	lines.push(`\t\t\t\t"hAcU${n}Map": { "type": "header", "size": 3, "text": "Mapping Innengerät ${n}", "xs": 12, "sm": 12, "md": 12, "lg": 12, "xl": 12 }`);
	for (const [role, label] of roles) {
		lines.push(`\t\t\t\t"${p}${role}_enabled": { "type": "checkbox", "label": "${label} aktiv", "default": ${["room_temp", "feedback_switch", "cmd_switch_on", "cmd_switch_off", "cmd_set_mode", "cmd_set_fan_mode", "cmd_set_cool_setpoint", "cmd_cleaning_start", "cmd_cleaning_mode", "cmd_refresh"].includes(role)}, "xs": 12, "sm": 4, "md": 3, "lg": 3, "xl": 3 }`);
		lines.push(`\t\t\t\t"${p}${role}_target": { "type": "objectId", "label": "${label} State-ID", "types": ["state"], "default": "", "xs": 12, "sm": 8, "md": 9, "lg": 9, "xl": 9 }`);
	}
	return lines.join(",\n");
}

for (let n = 1; n <= UNIT_COUNT; n++) {
	if (n > 1) {
		console.log(",");
	}
	console.log(unitFields(n));
}
