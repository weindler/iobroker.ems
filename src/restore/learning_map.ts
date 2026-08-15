/** Feste Mappingtabelle Backup-Key → Learning-Ziel (kein freier Pfad aus JSON). */

export const RESTORE_LEARNING_TARGETS: Readonly<Record<string, { category: string; fileName: string }>> = {
	"battery_runtime_learning_v1.json": { category: "learning/battery_runtime", fileName: "battery_runtime_learning_v1.json" },
	"house_load_learning_v1.json": { category: "learning/house_load", fileName: "house_load_learning_v1.json" },
	"thermal_runtime_learning_v1.json": { category: "learning/thermal_runtime", fileName: "thermal_runtime_learning_v1.json" },
	"thermal_boiler_learning_v1.json": { category: "learning/thermal_boiler", fileName: "thermal_boiler_learning_v1.json" },
	"price_learning_v1.json": { category: "learning/price_learning", fileName: "price_learning_v1.json" },
	"price_forecast_learning_v1.json": { category: "learning/price_forecast", fileName: "price_forecast_learning_v1.json" },
	"pv_bias_daily_v1.json": { category: "learning/pv_bias", fileName: "pv_bias_daily_v1.json" },
	"power_hourly_v1.json": { category: "learning/power_rollup", fileName: "power_hourly_v1.json" },
	"energy_daily_v1.json": { category: "learning/energy_daily_rollup", fileName: "energy_daily_v1.json" },
	"consumer_stats_v1.json": { category: "learning/consumer_stats", fileName: "consumer_stats_v1.json" },
	"day_evaluation_v1.json": { category: "learning/day_evaluation", fileName: "day_evaluation_v1.json" },
	"vehicle_presence_learning_v1.json": {
		category: "learning/vehicle_presence",
		fileName: "vehicle_presence_learning_v1.json",
	},
};

export const RESTORE_LEARNING_KEYS = Object.keys(RESTORE_LEARNING_TARGETS);

/** Relativer Zielpfad (Kategorie + Dateiname) unter dem Instanz-Datenroot. */
export function restoreLearningRelativeTargetPath(key: string): string {
	const target = RESTORE_LEARNING_TARGETS[key];
	if (!target) {
		throw new Error(`unknown learning key: ${key}`);
	}
	return `${target.category}/${target.fileName}`;
}

export function isKnownLearningKey(key: string): boolean {
	return key in RESTORE_LEARNING_TARGETS;
}
