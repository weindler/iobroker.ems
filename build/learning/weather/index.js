"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayResultToPersist = exports.writeWeatherDayPersist = exports.healthFromValidHours = exports.confidenceFromValidHours = exports.isValidMetricValue = exports.computeWeatherLearning = exports.runWeatherLearning = exports.stopWeatherLearning = exports.initWeatherLearning = void 0;
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
const run_1 = require("./run");
let weatherTimer = null;
async function initWeatherLearning(adapter) {
    const host = adapter;
    await (0, ensure_states_1.ensureWeatherLearningStates)(host);
    const cfg = (0, config_1.weatherConfigFromAdapter)(adapter.config);
    stopWeatherLearning();
    void (0, run_1.runWeatherLearning)(host).catch((e) => {
        adapter.log.error(`Weather-Learning initial run: ${e}`);
    });
    weatherTimer = setInterval(() => {
        void (0, run_1.runWeatherLearning)(host).catch((e) => {
            adapter.log.error(`Weather-Learning tick: ${e}`);
        });
    }, cfg.intervalSec * 1000);
    adapter.log.info(`EMS-Light Weather-Learning ready (read-only, interval ${cfg.intervalSec}s)`);
}
exports.initWeatherLearning = initWeatherLearning;
function stopWeatherLearning() {
    if (weatherTimer) {
        clearInterval(weatherTimer);
        weatherTimer = null;
    }
}
exports.stopWeatherLearning = stopWeatherLearning;
var run_2 = require("./run");
Object.defineProperty(exports, "runWeatherLearning", { enumerable: true, get: function () { return run_2.runWeatherLearning; } });
var math_1 = require("./math");
Object.defineProperty(exports, "computeWeatherLearning", { enumerable: true, get: function () { return math_1.computeWeatherLearning; } });
Object.defineProperty(exports, "isValidMetricValue", { enumerable: true, get: function () { return math_1.isValidMetricValue; } });
Object.defineProperty(exports, "confidenceFromValidHours", { enumerable: true, get: function () { return math_1.confidenceFromValidHours; } });
Object.defineProperty(exports, "healthFromValidHours", { enumerable: true, get: function () { return math_1.healthFromValidHours; } });
var persist_1 = require("./persist");
Object.defineProperty(exports, "writeWeatherDayPersist", { enumerable: true, get: function () { return persist_1.writeWeatherDayPersist; } });
Object.defineProperty(exports, "dayResultToPersist", { enumerable: true, get: function () { return persist_1.dayResultToPersist; } });
