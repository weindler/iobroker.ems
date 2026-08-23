/**
 * Generiert aus admin/jsonConfig.json (Klima-Tab, Innengerät 1) — NICHT von Hand pflegen.
 * Struktur-Template für einen Klima-Innengerät-Block (jsonConfig-Item-Paare).
 * "{N}" wird zur Generierungszeit durch die Geräte-Nummer (1..5) ersetzt.
 * Felder mit default = { "__override__": "<suffix>" } werden aus climate_unit_defaults.ts
 * (pro Gerät individuell) befüllt — siehe generate.ts.
 *
 * Neu erzeugen: npm run admin-config:generate
 */
export type ClimateUnitShapeEntry = [string, Record<string, unknown>];

export const CLIMATE_UNIT_SHAPE: ClimateUnitShapeEntry[] = [
 [
  "hAcU{N}",
  {
   "type": "header",
   "size": 2,
   "text": "Innengerät {N}",
   "xs": 12,
   "sm": 12,
   "md": 12,
   "lg": 12,
   "xl": 12
  }
 ],
 [
  "ac_u{N}_enabled",
  {
   "type": "checkbox",
   "label": "Aktiv",
   "default": {
    "__override__": "enabled"
   },
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_name",
  {
   "type": "text",
   "label": "Name",
   "default": {
    "__override__": "name"
   },
   "xs": 12,
   "sm": 8,
   "md": 6,
   "lg": 6,
   "xl": 6
  }
 ],
 [
  "ac_u{N}_profile",
  {
   "type": "select",
   "label": "Geräteprofil",
   "options": [
    {
     "label": "Generic",
     "value": "generic"
    },
    {
     "label": "Samsung SmartThings",
     "value": "samsung_smartthings"
    },
    {
     "label": "Samsung LocalThings (Home Assistant)",
     "value": "samsung_localthings_hass"
    }
   ],
   "default": "samsung_smartthings",
   "xs": 12,
   "sm": 6,
   "md": 4,
   "lg": 4,
   "xl": 4,
   "help": "SmartThings = Cloud. LocalThings = Home Assistant (hass.0). Beim Wechsel auf LocalThings werden leere/SmartThings-Mappings einmalig vorausgefüllt, vorhandene hass-Mappings bleiben."
  }
 ],
 [
  "ac_u{N}_active_from",
  {
   "type": "text",
   "label": "Aktiv ab (HH:MM)",
   "default": "08:00",
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_active_until",
  {
   "type": "text",
   "label": "Aktiv bis (HH:MM)",
   "default": {
    "__override__": "active_until"
   },
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_hard_off_at",
  {
   "type": "text",
   "label": "Hard-Off (HH:MM)",
   "default": {
    "__override__": "hard_off_at"
   },
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_estimated_power_w",
  {
   "type": "number",
   "label": "Geschätzte Leistung Kühlen (W)",
   "default": {
    "__override__": "estimated_power_w"
   },
   "min": 0,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "Elektrische Leistung im Kühlbetrieb (W). Beim Trocknen rechnet EMS mit der Hälfte."
  }
 ],
 [
  "hAcU{N}Cool",
  {
   "type": "header",
   "size": 3,
   "text": "Innengerät {N} — 1. Kühlen",
   "xs": 12,
   "sm": 12,
   "md": 12,
   "lg": 12,
   "xl": 12
  }
 ],
 [
  "ac_u{N}_on_temp_c",
  {
   "type": "number",
   "label": "Einschalttemperatur (°C)",
   "default": {
    "__override__": "on_temp_c"
   },
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "min": 10,
   "max": 45,
   "step": 0.1,
   "help": "Dezimalwerte mit Punkt (z. B. 24.5) oder Komma (24,5)."
  }
 ],
 [
  "ac_u{N}_off_temp_c",
  {
   "type": "number",
   "label": "Ausschalttemperatur (°C)",
   "default": {
    "__override__": "off_temp_c"
   },
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "min": 10,
   "max": 45,
   "step": 0.1,
   "help": "Dezimalwerte mit Punkt (z. B. 24.5) oder Komma (24,5)."
  }
 ],
 [
  "ac_u{N}_cooling_setpoint_c",
  {
   "type": "number",
   "label": "Kühl-Sollwert (°C)",
   "default": 17,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "min": 10,
   "max": 45,
   "step": 0.1,
   "help": "Dezimalwerte mit Punkt (z. B. 24.5) oder Komma (24,5)."
  }
 ],
 [
  "ac_u{N}_mode_when_cooling",
  {
   "type": "text",
   "label": "Modus Kühlen",
   "default": "cool",
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "Leer = Kühlen deaktiviert. Sonst Gerätebefehl (z. B. cool)."
  }
 ],
 [
  "ac_u{N}_fan_mode_when_cooling",
  {
   "type": "text",
   "label": "Lüftermodus Kühlen",
   "default": "auto",
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "Leer = Kühlen deaktiviert. Sonst Gerätebefehl (z. B. cool)."
  }
 ],
 [
  "ac_u{N}_fan_speed_when_cooling",
  {
   "type": "text",
   "label": "Lüfterstärke Kühlen (optional)",
   "default": "",
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "hAcU{N}Dry",
  {
   "type": "header",
   "size": 3,
   "text": "Innengerät {N} — 2. Trocknen",
   "xs": 12,
   "sm": 12,
   "md": 12,
   "lg": 12,
   "xl": 12
  }
 ],
 [
  "ac_u{N}_max_humidity_pct",
  {
   "type": "number",
   "label": "Max. Feuchte (%) — optional",
   "min": 0,
   "max": 100,
   "default": 0,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "0 = Trocknen aus (Feuchte nur anzeigen). &gt;0 = Einschalt-Feuchte für Dry."
  }
 ],
 [
  "ac_u{N}_humidity_off_hysteresis_pct",
  {
   "type": "number",
   "label": "Feuchte-Hysterese (%-Punkte)",
   "default": 3,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "min": 0,
   "max": 30,
   "step": 1,
   "help": "Dry aus bei Feuchte ≤ Max − Hysterese (z. B. Max 60, Hysterese 3 → aus bei ≤57 %)."
  }
 ],
 [
  "ac_u{N}_mode_when_dehumidify",
  {
   "type": "text",
   "label": "Modus Entfeuchten",
   "default": "dry",
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "Leer = Trocknen deaktiviert. Sonst Gerätebefehl (z. B. dry). Zusätzlich Max-Feuchte &gt; 0."
  }
 ],
 [
  "ac_u{N}_fan_mode_when_dehumidify",
  {
   "type": "text",
   "label": "Lüftermodus Entfeuchten",
   "default": "auto",
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "Leer = Trocknen deaktiviert. Sonst Gerätebefehl (z. B. dry). Zusätzlich Max-Feuchte &gt; 0."
  }
 ],
 [
  "hAcU{N}Heat",
  {
   "type": "header",
   "size": 3,
   "text": "Innengerät {N} — 3. Heizen (noch nicht aktiv)",
   "xs": 12,
   "sm": 12,
   "md": 12,
   "lg": 12,
   "xl": 12
  }
 ],
 [
  "acU{N}HeatHint",
  {
   "type": "staticText",
   "xs": 12,
   "sm": 12,
   "md": 12,
   "lg": 12,
   "xl": 12,
   "text": "Heizen ist vorbereitet, die Steuerung ist noch nicht aktiv. Modus leer lassen = aus. Reinigung nach Heizen normalerweise nicht nötig (kein Kondensat)."
  }
 ],
 [
  "ac_u{N}_mode_when_heating",
  {
   "type": "text",
   "label": "Modus Heizen",
   "default": "",
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "Leer = Heizen deaktiviert. Sonst Gerätebefehl (z. B. heat)."
  }
 ],
 [
  "ac_u{N}_fan_mode_when_heating",
  {
   "type": "text",
   "label": "Lüftermodus Heizen",
   "default": "auto",
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "Lüftermodus beim Heizen (z. B. auto)."
  }
 ],
 [
  "hAcU{N}Clean",
  {
   "type": "header",
   "size": 3,
   "text": "Innengerät {N} — 4. Reinigung",
   "xs": 12,
   "sm": 12,
   "md": 12,
   "lg": 12,
   "xl": 12
  }
 ],
 [
  "acU{N}CleanHint",
  {
   "type": "staticText",
   "xs": 12,
   "sm": 12,
   "md": 12,
   "lg": 12,
   "xl": 12,
   "text": "Nach Cool/Dry entsteht Kondensat → Auto-Reinigung sinnvoll. Nach Heizen typisch nicht nötig."
  }
 ],
 [
  "ac_u{N}_cleaning_after_cooling",
  {
   "type": "checkbox",
   "label": "Reinigung nach Kühlen",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "Nach Cool-Lauf automatisch reinigen."
  }
 ],
 [
  "ac_u{N}_cleaning_after_dehumidify",
  {
   "type": "checkbox",
   "label": "Reinigung nach Trocknen",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "Nach Dry-Lauf automatisch reinigen."
  }
 ],
 [
  "ac_u{N}_cleaning_after_heating",
  {
   "type": "checkbox",
   "label": "Reinigung nach Heizen",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "Normalerweise aus — beim Heizen entsteht kein Kondensat wie beim Kühlen."
  }
 ],
 [
  "ac_u{N}_cleaning_delay_min",
  {
   "type": "number",
   "label": "Reinigung Verzögerung (min)",
   "default": 1,
   "min": 0,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_cleaning_duration_min",
  {
   "type": "number",
   "label": "Reinigung Timeout (min)",
   "default": {
    "__override__": "cleaning_duration_min"
   },
   "min": 0,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "help": "Fallback wenn SmartThings-Feedback ausbleibt. Ende normalerweise über operatingState=ready."
  }
 ],
 [
  "hAcU{N}Stats",
  {
   "type": "header",
   "size": 3,
   "text": "Innengerät {N} — Statistik",
   "xs": 12,
   "sm": 12,
   "md": 12,
   "lg": 12,
   "xl": 12
  }
 ],
 [
  "ac_u{N}_stats_enabled",
  {
   "type": "checkbox",
   "label": "Statistik aktiv",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_stats_track_runtime",
  {
   "type": "checkbox",
   "label": "Laufzeit mitloggen",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_stats_track_energy",
  {
   "type": "checkbox",
   "label": "Verbrauch mitloggen",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_stats_runtime_offset_h",
  {
   "type": "number",
   "label": "Offset Laufzeit (h)",
   "default": 0,
   "min": 0,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_stats_energy_offset_kwh",
  {
   "type": "number",
   "label": "Offset Verbrauch (kWh)",
   "default": 0,
   "min": 0,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "hAcU{N}Map",
  {
   "type": "header",
   "size": 3,
   "text": "Innengerät {N} — Mapping",
   "xs": 12,
   "sm": 12,
   "md": 12,
   "lg": 12,
   "xl": 12
  }
 ],
 [
  "ac_u{N}_room_temp_enabled",
  {
   "type": "checkbox",
   "label": "Raumtemperatur aktiv",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_room_temp_target",
  {
   "type": "objectId",
   "label": "Raumtemperatur State-ID",
   "default": {
    "__override__": "room_temp_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_room_humidity_enabled",
  {
   "type": "checkbox",
   "label": "Raumfeuchte aktiv",
   "default": {
    "__override__": "room_humidity_enabled"
   },
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_room_humidity_target",
  {
   "type": "objectId",
   "label": "Raumfeuchte State-ID",
   "default": {
    "__override__": "room_humidity_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_feedback_switch_enabled",
  {
   "type": "checkbox",
   "label": "Rückmeldung Ein/Aus aktiv",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_feedback_switch_target",
  {
   "type": "objectId",
   "label": "Rückmeldung Ein/Aus State-ID",
   "default": {
    "__override__": "feedback_switch_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_feedback_mode_enabled",
  {
   "type": "checkbox",
   "label": "Rückmeldung Modus aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_feedback_mode_target",
  {
   "type": "objectId",
   "label": "Rückmeldung Modus State-ID",
   "default": {
    "__override__": "feedback_mode_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_cmd_switch_on_enabled",
  {
   "type": "checkbox",
   "label": "Befehl EIN aktiv",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_cmd_switch_on_target",
  {
   "type": "objectId",
   "label": "Befehl EIN State-ID",
   "default": {
    "__override__": "cmd_switch_on_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_cmd_switch_off_enabled",
  {
   "type": "checkbox",
   "label": "Befehl AUS aktiv",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_cmd_switch_off_target",
  {
   "type": "objectId",
   "label": "Befehl AUS State-ID",
   "default": {
    "__override__": "cmd_switch_off_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_cmd_set_mode_enabled",
  {
   "type": "checkbox",
   "label": "Befehl Modus aktiv",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_cmd_set_mode_target",
  {
   "type": "objectId",
   "label": "Befehl Modus State-ID",
   "default": {
    "__override__": "cmd_set_mode_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_cmd_set_fan_mode_enabled",
  {
   "type": "checkbox",
   "label": "Befehl Lüftermodus aktiv",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_cmd_set_fan_mode_target",
  {
   "type": "objectId",
   "label": "Befehl Lüftermodus State-ID",
   "default": {
    "__override__": "cmd_set_fan_mode_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_cmd_set_fan_speed_enabled",
  {
   "type": "checkbox",
   "label": "Befehl Lüfterstärke aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_cmd_set_fan_speed_target",
  {
   "type": "objectId",
   "label": "Befehl Lüfterstärke State-ID",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_cmd_set_cool_setpoint_enabled",
  {
   "type": "checkbox",
   "label": "Befehl Kühl-Sollwert aktiv",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_cmd_set_cool_setpoint_target",
  {
   "type": "objectId",
   "label": "Befehl Kühl-Sollwert State-ID",
   "default": {
    "__override__": "cmd_set_cool_setpoint_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_cmd_set_heat_setpoint_enabled",
  {
   "type": "checkbox",
   "label": "Befehl Heiz-Sollwert aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_cmd_set_heat_setpoint_target",
  {
   "type": "objectId",
   "label": "Befehl Heiz-Sollwert State-ID",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_cmd_cleaning_start_enabled",
  {
   "type": "checkbox",
   "label": "Befehl Reinigung start aktiv",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_cmd_cleaning_start_target",
  {
   "type": "objectId",
   "label": "Befehl Reinigung start State-ID",
   "default": {
    "__override__": "cmd_cleaning_start_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ]
  }
 ],
 [
  "ac_u{N}_feedback_cleaning_state_enabled",
  {
   "type": "checkbox",
   "label": "Rückmeldung Reinigung operatingState aktiv",
   "default": {
    "__override__": "feedback_cleaning_state_enabled"
   },
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_feedback_cleaning_state_target",
  {
   "type": "objectId",
   "label": "Rückmeldung Reinigung operatingState State-ID",
   "types": [
    "state"
   ],
   "default": {
    "__override__": "feedback_cleaning_state_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9
  }
 ],
 [
  "ac_u{N}_feedback_cleaning_mode_enabled",
  {
   "type": "checkbox",
   "label": "Rückmeldung Reinigung autoCleaningMode aktiv",
   "default": {
    "__override__": "feedback_cleaning_mode_enabled"
   },
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_feedback_cleaning_mode_target",
  {
   "type": "objectId",
   "label": "Rückmeldung Reinigung autoCleaningMode State-ID",
   "types": [
    "state"
   ],
   "default": {
    "__override__": "feedback_cleaning_mode_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9
  }
 ],
 [
  "ac_u{N}_feedback_cleaning_progress_enabled",
  {
   "type": "checkbox",
   "label": "Rückmeldung Reinigung Fortschritt aktiv",
   "default": {
    "__override__": "feedback_cleaning_progress_enabled"
   },
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3
  }
 ],
 [
  "ac_u{N}_feedback_cleaning_progress_target",
  {
   "type": "objectId",
   "label": "Rückmeldung Reinigung Fortschritt State-ID",
   "types": [
    "state"
   ],
   "default": {
    "__override__": "feedback_cleaning_progress_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9
  }
 ],
 [
  "ac_u{N}_cmd_refresh_enabled",
  {
   "type": "checkbox",
   "label": "Befehl Refresh aktiv",
   "default": true,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile === 'samsung_localthings_hass'",
   "help": "Nur SmartThings/Cloud — bei LocalThings nicht nötig."
  }
 ],
 [
  "ac_u{N}_cmd_refresh_target",
  {
   "type": "objectId",
   "label": "Befehl Refresh State-ID",
   "default": {
    "__override__": "cmd_refresh_target"
   },
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": [
    "state"
   ],
   "hidden": "data.ac_u{N}_profile === 'samsung_localthings_hass'"
  }
 ],
 [
  "hAcU{N}LtMaint",
  {
   "type": "header",
   "size": 3,
   "text": "Innengerät {N} — LocalThings Wartung / Diagnose (optional)",
   "xs": 12,
   "sm": 12,
   "md": 12,
   "lg": 12,
   "xl": 12,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_cleaning_off_enabled",
  {
   "type": "checkbox",
   "label": "Auto-Clean AUS aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_cleaning_off_target",
  {
   "type": "objectId",
   "label": "Auto-Clean AUS (turn_off)",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_feedback_setpoint_enabled",
  {
   "type": "checkbox",
   "label": "Solltemperatur-Feedback aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_feedback_setpoint_target",
  {
   "type": "objectId",
   "label": "Solltemperatur-Feedback",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_power_w_enabled",
  {
   "type": "checkbox",
   "label": "Leistung W aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'",
   "help": "0 W bei laufender AC ist oft ungültig — EMS nutzt dann gelernte/geschätzte Leistung."
  }
 ],
 [
  "ac_u{N}_power_w_target",
  {
   "type": "objectId",
   "label": "Leistung W",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_energy_kwh_enabled",
  {
   "type": "checkbox",
   "label": "Energie kWh aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_energy_kwh_target",
  {
   "type": "objectId",
   "label": "Energie kWh",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_filter_usage_pct_enabled",
  {
   "type": "checkbox",
   "label": "Filternutzung % aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_filter_usage_pct_target",
  {
   "type": "objectId",
   "label": "Filternutzung %",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_filter_usage_hours_enabled",
  {
   "type": "checkbox",
   "label": "Filternutzungsstunden aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_filter_usage_hours_target",
  {
   "type": "objectId",
   "label": "Filternutzungsstunden",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_filter_status_enabled",
  {
   "type": "checkbox",
   "label": "Filterstatus aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'",
   "help": "Gerätewert normal/wash/replace — keine Ableitung aus Stunden."
  }
 ],
 [
  "ac_u{N}_filter_status_target",
  {
   "type": "objectId",
   "label": "Filterstatus",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_diagnosis_status_enabled",
  {
   "type": "checkbox",
   "label": "Diagnosestatus aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_diagnosis_status_target",
  {
   "type": "objectId",
   "label": "Diagnosestatus",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_diagnosis_start_enabled",
  {
   "type": "checkbox",
   "label": "Diagnose starten aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_diagnosis_start_target",
  {
   "type": "objectId",
   "label": "Diagnose starten (press)",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_firmware_update_enabled",
  {
   "type": "checkbox",
   "label": "Firmware-Update verfügbar aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_firmware_update_target",
  {
   "type": "objectId",
   "label": "Firmware-Update verfügbar",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_display_light_enabled",
  {
   "type": "checkbox",
   "label": "Displaybeleuchtung-Feedback aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_display_light_target",
  {
   "type": "objectId",
   "label": "Displaybeleuchtung Feedback",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_display_on_enabled",
  {
   "type": "checkbox",
   "label": "Display EIN aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_display_on_target",
  {
   "type": "objectId",
   "label": "Display EIN",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_display_off_enabled",
  {
   "type": "checkbox",
   "label": "Display AUS aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_display_off_target",
  {
   "type": "objectId",
   "label": "Display AUS",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_sound_enabled",
  {
   "type": "checkbox",
   "label": "Signalton-Feedback aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_sound_target",
  {
   "type": "objectId",
   "label": "Signalton Feedback",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_sound_on_enabled",
  {
   "type": "checkbox",
   "label": "Signalton EIN aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_sound_on_target",
  {
   "type": "objectId",
   "label": "Signalton EIN",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_sound_off_enabled",
  {
   "type": "checkbox",
   "label": "Signalton AUS aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_sound_off_target",
  {
   "type": "objectId",
   "label": "Signalton AUS",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_mute_once_enabled",
  {
   "type": "checkbox",
   "label": "Einmal stummschalten aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_mute_once_target",
  {
   "type": "objectId",
   "label": "Einmal stummschalten",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_set_preset_mode_enabled",
  {
   "type": "checkbox",
   "label": "Preset schreiben aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_set_preset_mode_target",
  {
   "type": "objectId",
   "label": "Preset schreiben (set_preset_mode)",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_feedback_preset_mode_enabled",
  {
   "type": "checkbox",
   "label": "Preset-Feedback aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_feedback_preset_mode_target",
  {
   "type": "objectId",
   "label": "Preset-Feedback",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_set_swing_mode_enabled",
  {
   "type": "checkbox",
   "label": "Swing schreiben aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_cmd_set_swing_mode_target",
  {
   "type": "objectId",
   "label": "Swing schreiben",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_feedback_swing_mode_enabled",
  {
   "type": "checkbox",
   "label": "Swing-Feedback aktiv",
   "default": false,
   "xs": 12,
   "sm": 4,
   "md": 3,
   "lg": 3,
   "xl": 3,
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ],
 [
  "ac_u{N}_feedback_swing_mode_target",
  {
   "type": "objectId",
   "label": "Swing-Feedback",
   "xs": 12,
   "sm": 8,
   "md": 9,
   "lg": 9,
   "xl": 9,
   "types": ["state"],
   "hidden": "data.ac_u{N}_profile !== 'samsung_localthings_hass'"
  }
 ]
];
