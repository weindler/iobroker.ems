import {
	SEGMENT_HOURS,
	type HouseLoadDayType,
	type HouseLoadSeason,
	type HouseLoadSegment,
	type HouseLoadWeekday,
	WEEKDAYS,
} from "./constants";

export function localDateKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function seasonFromDate(d: Date): HouseLoadSeason {
	const month = d.getMonth() + 1;
	if (month >= 3 && month <= 5) return "spring";
	if (month >= 6 && month <= 8) return "summer";
	if (month >= 9 && month <= 11) return "autumn";
	return "winter";
}

export function weekdayFromDate(d: Date): HouseLoadWeekday {
	const idx = (d.getDay() + 6) % 7;
	return WEEKDAYS[idx];
}

export function dayTypeFromWeekday(weekday: HouseLoadWeekday): HouseLoadDayType {
	return weekday === "saturday" || weekday === "sunday" ? "weekend" : "weekday";
}

export function segmentFromHour(hour: number): HouseLoadSegment {
	for (const [name, bounds] of Object.entries(SEGMENT_HOURS) as [
		HouseLoadSegment,
		{ start: number; end: number },
	][]) {
		if (hour >= bounds.start && hour < bounds.end) {
			return name;
		}
	}
	return "evening";
}

export function calendarContext(d: Date): {
	dateKey: string;
	season: HouseLoadSeason;
	weekday: HouseLoadWeekday;
	dayType: HouseLoadDayType;
	segment: HouseLoadSegment;
	hourOfDay: number;
} {
	const hourOfDay = d.getHours();
	const weekday = weekdayFromDate(d);
	return {
		dateKey: localDateKey(d),
		season: seasonFromDate(d),
		weekday,
		dayType: dayTypeFromWeekday(weekday),
		segment: segmentFromHour(hourOfDay),
		hourOfDay,
	};
}

export function dateKeyWithOffset(dayOffset: number): string {
	const d = new Date();
	d.setHours(12, 0, 0, 0);
	d.setDate(d.getDate() + dayOffset);
	return localDateKey(d);
}

export function contextForDayOffset(dayOffset: number): {
	dateKey: string;
	season: HouseLoadSeason;
	weekday: HouseLoadWeekday;
	dayType: HouseLoadDayType;
} {
	const d = new Date();
	d.setHours(12, 0, 0, 0);
	d.setDate(d.getDate() + dayOffset);
	const weekday = weekdayFromDate(d);
	return {
		dateKey: localDateKey(d),
		season: seasonFromDate(d),
		weekday,
		dayType: dayTypeFromWeekday(weekday),
	};
}
