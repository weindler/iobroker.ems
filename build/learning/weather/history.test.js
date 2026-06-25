"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const history_1 = require("./history");
const HOUR = 3_600_000;
function makeHost(byId) {
    return {
        getHistoryAsync: async (id) => ({
            result: (byId[id] ?? []),
        }),
    };
}
/** Zeilen über mehrere Stunden eines Tages (dayOffset). */
function hourlyRows(dayOffset, hours, value) {
    const { start } = (0, history_1.dayBoundsMs)(dayOffset);
    return hours.map((h) => ({ ts: start + h * HOUR + 60_000, val: value }));
}
(0, node_test_1.describe)("weather evaluateWeatherDay", () => {
    (0, node_test_1.it)("berechnet jede Metrik über ihre EIGENEN Stunden (Regen unabhängig von Temp)", async () => {
        const metrics = {
            temp: { forecastStateId: "brightsky.0.temp", actualStateId: "0_userdata.0.temp" },
            rain: { forecastStateId: "brightsky.0.rain", actualStateId: "0_userdata.0.rain" },
        };
        // Temp deckt viele Stunden ab; Regen nur 3 ANDERE Stunden — früher fiel Regen weg.
        const host = makeHost({
            "brightsky.0.temp": hourlyRows(1, [0, 1, 2, 3, 4, 5, 6, 7], 10),
            "0_userdata.0.temp": hourlyRows(1, [0, 1, 2, 3, 4, 5, 6, 7], 12),
            "brightsky.0.rain": hourlyRows(1, [20, 21, 22], 1),
            "0_userdata.0.rain": hourlyRows(1, [20, 21, 22], 2.5),
        });
        const day = await (0, history_1.evaluateWeatherDay)(host, metrics, 1);
        strict_1.default.equal(day.metrics.temp?.validHours, 8);
        strict_1.default.equal(day.metrics.temp?.bias, 2); // 12 - 10
        strict_1.default.equal(day.metrics.rain?.validHours, 3);
        strict_1.default.equal(day.metrics.rain?.bias, 1.5); // 2.5 - 1
        strict_1.default.equal(day.validHours, 8); // bestabgedeckte Metrik
    });
    (0, node_test_1.it)("liefert Regen-Bias=null mit missingActual, wenn die Ist-Seite keine History hat", async () => {
        const metrics = {
            temp: { forecastStateId: "brightsky.0.temp", actualStateId: "0_userdata.0.temp" },
            rain: { forecastStateId: "brightsky.0.rain", actualStateId: "0_userdata.0.rain" },
        };
        const host = makeHost({
            "brightsky.0.temp": hourlyRows(1, [0, 1, 2, 3, 4, 5], 10),
            "0_userdata.0.temp": hourlyRows(1, [0, 1, 2, 3, 4, 5], 11),
            "brightsky.0.rain": hourlyRows(1, [10, 11, 12], 1),
            // rain Ist fehlt komplett
        });
        const day = await (0, history_1.evaluateWeatherDay)(host, metrics, 1);
        strict_1.default.equal(day.metrics.temp?.bias, 1);
        strict_1.default.equal(day.metrics.rain?.bias, null);
        strict_1.default.equal(day.metrics.rain?.validHours, 0);
        strict_1.default.ok(day.missingActual.includes("rain"));
        strict_1.default.ok(!day.missingActual.includes("temp"));
    });
});
