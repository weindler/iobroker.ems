"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePvHorizonLearningStates = exports.PV_HORIZON_EXTENDED_DAY_COUNT = exports.PV_HORIZON_EXTENDED_FIRST_DAY = exports.PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY = exports.PV_HORIZON_BIAS_WEIGHT_BY_DAY = exports.pvHorizonConfigFromAdapter = exports.hasPvForecastTodayTomorrow = exports.horizonDayConfidencePct = exports.effectiveBiasPct = exports.computePvHorizon = exports.runPvHorizon = void 0;
const ensure_states_1 = require("./ensure_states");
var run_1 = require("./run");
Object.defineProperty(exports, "runPvHorizon", { enumerable: true, get: function () { return run_1.runPvHorizon; } });
var math_1 = require("./math");
Object.defineProperty(exports, "computePvHorizon", { enumerable: true, get: function () { return math_1.computePvHorizon; } });
Object.defineProperty(exports, "effectiveBiasPct", { enumerable: true, get: function () { return math_1.effectiveBiasPct; } });
Object.defineProperty(exports, "horizonDayConfidencePct", { enumerable: true, get: function () { return math_1.horizonDayConfidencePct; } });
var config_1 = require("./config");
Object.defineProperty(exports, "hasPvForecastTodayTomorrow", { enumerable: true, get: function () { return config_1.hasPvForecastTodayTomorrow; } });
Object.defineProperty(exports, "pvHorizonConfigFromAdapter", { enumerable: true, get: function () { return config_1.pvHorizonConfigFromAdapter; } });
var constants_1 = require("./constants");
Object.defineProperty(exports, "PV_HORIZON_BIAS_WEIGHT_BY_DAY", { enumerable: true, get: function () { return constants_1.PV_HORIZON_BIAS_WEIGHT_BY_DAY; } });
Object.defineProperty(exports, "PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY", { enumerable: true, get: function () { return constants_1.PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY; } });
Object.defineProperty(exports, "PV_HORIZON_EXTENDED_FIRST_DAY", { enumerable: true, get: function () { return constants_1.PV_HORIZON_EXTENDED_FIRST_DAY; } });
Object.defineProperty(exports, "PV_HORIZON_EXTENDED_DAY_COUNT", { enumerable: true, get: function () { return constants_1.PV_HORIZON_EXTENDED_DAY_COUNT; } });
async function ensurePvHorizonLearningStates(host) {
    await (0, ensure_states_1.ensurePvHorizonStates)(host);
}
exports.ensurePvHorizonLearningStates = ensurePvHorizonLearningStates;
