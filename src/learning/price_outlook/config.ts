export type PriceOutlookConfig = {
	enabled: boolean;
	latitude: number | null;
	longitude: number | null;
	timezone: string;
	pvKwp: number | null;
	pvKwpStateIds: string[];
	todayJsonStateId: string;
	tomorrowJsonStateId: string;
};

function boolField(c: Record<string, unknown>, key: string, fallback: boolean): boolean {
	const value = c[key];
	if (typeof value === "boolean") return value;
	if (value === 1 || value === "1" || value === "true") return true;
	if (value === 0 || value === "0" || value === "false") return false;
	return fallback;
}

function numField(c: Record<string, unknown>, key: string): number | null {
	const value = c[key];
	if (value === null || value === undefined || value === "") return null;
	const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
	return Number.isFinite(parsed) ? parsed : null;
}

function strField(c: Record<string, unknown>, key: string): string {
	const value = c[key];
	return typeof value === "string" ? value.trim() : "";
}

export function priceOutlookConfigFromAdapter(config: unknown): PriceOutlookConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	return {
		// Externe Abrufe erst nach bewusster Admin-Aktivierung. Das Admin-Feld ist bei
		// neuen/gespeicherten Konfigurationen standardmäßig an; alte Instanzen ohne
		// dieses Feld starten dadurch nicht ungefragt einen großen 24-Monats-Import.
		enabled: boolField(c, "price_outlook_enabled", false),
		latitude: numField(c, "price_outlook_latitude"),
		longitude: numField(c, "price_outlook_longitude"),
		timezone: strField(c, "price_outlook_timezone"),
		pvKwp: numField(c, "price_outlook_pv_kwp"),
		pvKwpStateIds: [strField(c, "pv_shape_kwp_state_1"), strField(c, "pv_shape_kwp_state_2")].filter(Boolean),
		todayJsonStateId: strField(c, "learning_price_forecast_today_json_state"),
		tomorrowJsonStateId: strField(c, "learning_price_forecast_tomorrow_json_state"),
	};
}
