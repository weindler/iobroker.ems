/** Write-Payloads für Samsung LocalThings über hass.0 (stringified JSON). */

export function localthingsHvacModePayload(mode: string): Record<string, unknown> {
	return { hvac_mode: String(mode ?? "").trim() };
}

export function localthingsTemperaturePayload(temperatureC: number): Record<string, unknown> {
	return { temperature: temperatureC };
}

export function localthingsFanModePayload(fanMode: string): Record<string, unknown> {
	return { fan_mode: String(fanMode ?? "").trim() };
}

export function localthingsPresetModePayload(preset: string): Record<string, unknown> {
	return { preset_mode: String(preset ?? "").trim() };
}

export function localthingsSwingModePayload(swing: string): Record<string, unknown> {
	return { swing_mode: String(swing ?? "").trim() };
}

export function stringifyLocalthingsPayload(payload: Record<string, unknown>): string {
	return JSON.stringify(payload);
}
