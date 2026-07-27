/** Weather horizon days 3–7 (Block 9). Day index matches calendar offset from today (3 = +2 days). */
export const WEATHER_HORIZON_FIRST_DAY = 3;
export const WEATHER_HORIZON_LAST_DAY = 7;
export const WEATHER_HORIZON_DAY_INDEXES = [3, 4, 5, 6, 7] as const;

export type WeatherHorizonDayIndex = (typeof WEATHER_HORIZON_DAY_INDEXES)[number];
