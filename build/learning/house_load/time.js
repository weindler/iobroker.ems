"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localDateKey = localDateKey;
exports.seasonFromDate = seasonFromDate;
exports.weekdayFromDate = weekdayFromDate;
exports.dayTypeFromWeekday = dayTypeFromWeekday;
exports.segmentFromHour = segmentFromHour;
exports.calendarContext = calendarContext;
exports.dateKeyWithOffset = dateKeyWithOffset;
exports.contextForDayOffset = contextForDayOffset;
const constants_1 = require("./constants");
function localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function seasonFromDate(d) {
    const month = d.getMonth() + 1;
    if (month >= 3 && month <= 5)
        return "spring";
    if (month >= 6 && month <= 8)
        return "summer";
    if (month >= 9 && month <= 11)
        return "autumn";
    return "winter";
}
function weekdayFromDate(d) {
    const idx = (d.getDay() + 6) % 7;
    return constants_1.WEEKDAYS[idx];
}
function dayTypeFromWeekday(weekday) {
    return weekday === "saturday" || weekday === "sunday" ? "weekend" : "weekday";
}
function segmentFromHour(hour) {
    for (const [name, bounds] of Object.entries(constants_1.SEGMENT_HOURS)) {
        if (hour >= bounds.start && hour < bounds.end) {
            return name;
        }
    }
    return "evening";
}
function calendarContext(d) {
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
function dateKeyWithOffset(dayOffset) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    return localDateKey(d);
}
function contextForDayOffset(dayOffset) {
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
