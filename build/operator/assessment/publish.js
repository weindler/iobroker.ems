"use strict";
/**
 * Schreibt die operative Einschätzung aus bereits bekanntem Plan + Live-States.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishOperationalAssessment = exports.OPERATOR_ASSESSMENT_DE = exports.OPERATOR_ASSESSMENT_JSON = void 0;
const state_util_1 = require("../../ems_light/state_util");
const ensure_states_1 = require("../../addons/battery/ensure_states");
const types_1 = require("../../addons/immersion_heater/runtime/types");
const state_write_1 = require("../../policy/core/state_write");
const strategic_status_1 = require("../../beta/strategic_status");
const build_1 = require("./build");
exports.OPERATOR_ASSESSMENT_JSON = "operator.assessment.json";
exports.OPERATOR_ASSESSMENT_DE = "operator.assessment_de";
function asBool(v) {
    if (v === true || v === false)
        return v;
    if (v === 1 || v === "1" || v === "true")
        return true;
    if (v === 0 || v === "0" || v === "false")
        return false;
    return null;
}
async function readNum(host, id) {
    try {
        return (0, state_util_1.asNum)((await host.getStateAsync(id))?.val);
    }
    catch {
        return null;
    }
}
async function readStr(host, id) {
    try {
        const v = (await host.getStateAsync(id))?.val;
        if (v == null || v === "")
            return null;
        return String(v);
    }
    catch {
        return null;
    }
}
async function readBool(host, id) {
    try {
        return asBool((await host.getStateAsync(id))?.val);
    }
    catch {
        return null;
    }
}
async function publishOperationalAssessment(host, input) {
    const [pvTodayKwh, pvTomorrowKwh, weatherTodayMinC, weatherTodayMaxC, weatherTomorrowMinC, weatherTomorrowMaxC, surplusW, priceNowCt, gbEnabled, gbActive, gbReady, gbPriceAllowed, gbBlock, gbRequested, gbMin, gbPrice, ihMode, ihAuto, ihHygieneJson,] = await Promise.all([
        readNum(host, "learning.pv_bias.corrected_today_kwh"),
        readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
        readNum(host, "learning.weather.horizon.day1.min_temp_c"),
        readNum(host, "learning.weather.horizon.day1.max_temp_c"),
        readNum(host, "learning.weather.horizon.day2.min_temp_c"),
        readNum(host, "learning.weather.horizon.day2.max_temp_c"),
        readNum(host, "operator.diagnostics.surplus_w"),
        readNum(host, "live.price.now_ct_per_kwh"),
        readBool(host, ensure_states_1.BAT.gridBalance.enabled),
        readBool(host, ensure_states_1.BAT.gridBalance.active),
        readBool(host, ensure_states_1.BAT.gridBalance.ready),
        readBool(host, ensure_states_1.BAT.gridBalance.priceAllowed),
        readStr(host, ensure_states_1.BAT.gridBalance.blockReason),
        readNum(host, ensure_states_1.BAT.gridBalance.requestedPowerW),
        readNum(host, ensure_states_1.BAT.gridBalance.priceMinCtKwh),
        readNum(host, ensure_states_1.BAT.gridBalance.currentPriceCtKwh),
        readStr(host, "addons.immersion_heater.mode"),
        readBool(host, types_1.IMMERSION_RUNTIME_STATES.autoTargetReached),
        readStr(host, "addons.immersion_heater.runtime.hygiene_json"),
    ]);
    const ihForced = ihMode === "force";
    let hygieneDue = input.plannerInput?.thermal?.hygieneDue === true;
    if (ihHygieneJson) {
        try {
            const j = JSON.parse(ihHygieneJson);
            if (j?.due === true)
                hygieneDue = true;
        }
        catch {
            /* ignore */
        }
    }
    const thermal = input.plannerInput?.thermal ?? null;
    const strategy = input.plan && input.plannerInput
        ? (0, strategic_status_1.buildAddonStrategicPlanSnapshot)({
            plan: input.plan,
            plannerInput: input.plannerInput,
            nowMs: input.now.getTime(),
            generatedAtIso: input.now.toISOString(),
        })
        : null;
    const buildInput = {
        now: input.now,
        timezone: input.timezone,
        plan: input.plan,
        plannerInput: input.plannerInput,
        contributions: input.contributions,
        strategy,
        pvTodayKwh,
        pvTomorrowKwh,
        weatherTodayMinC,
        weatherTodayMaxC,
        weatherTomorrowMinC,
        weatherTomorrowMaxC,
        surplusW,
        priceNowCt,
        gb: {
            enabled: gbEnabled,
            active: gbActive,
            ready: gbReady,
            priceAllowed: gbPriceAllowed,
            blockReason: gbBlock,
            requestedPowerW: gbRequested,
            minPriceCt: gbMin,
            currentPriceCt: gbPrice ?? priceNowCt,
        },
        immersion: {
            boilerTempC: thermal?.boilerTempC ?? (await readNum(host, "live.thermal.boiler_temp_c")),
            bufferTempC: thermal?.bufferTempC ?? (await readNum(host, "live.thermal.buffer_temp_c")),
            targetTempC: thermal?.dayTargetTempC ?? thermal?.forecastTargetTempC ?? null,
            maxTempC: thermal?.maxTempC ?? null,
            boilerMinC: thermal?.boilerMinTempC ?? thermal?.minTempC ?? null,
            hygieneDue,
            forced: ihForced,
            autoTargetReached: ihAuto === true,
            requiredFlexKwh: null,
            mode: ihMode,
        },
    };
    const assessment = (0, build_1.buildOperationalAssessment)(buildInput);
    const writer = host;
    await (0, state_write_1.setStateIfChanged)(writer, exports.OPERATOR_ASSESSMENT_JSON, JSON.stringify(assessment));
    await (0, state_write_1.setStateIfChanged)(writer, exports.OPERATOR_ASSESSMENT_DE, (0, build_1.formatOperationalAssessmentDe)(assessment));
}
exports.publishOperationalAssessment = publishOperationalAssessment;
