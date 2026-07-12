"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeForecastPlanForWrites = void 0;
const forecast_plan_write_probe_1 = require("../../diagnostics/forecast_plan_write_probe");
/** Serialize each forecast mirror once; caller writes sequentially and drops references. */
function serializeForecastPlanForWrites(plan) {
    const activeContributorsJson = JSON.stringify(plan.activeContributors);
    const excludedContributorsJson = JSON.stringify(plan.excludedContributors);
    const daysJson = JSON.stringify(plan.days);
    const slotsJson = JSON.stringify(plan.slots);
    const contributionsJson = JSON.stringify(plan.contributions);
    const planJson = JSON.stringify(plan);
    const fields = [
        { stateId: "active_contributors_json", value: activeContributorsJson, bytes: (0, forecast_plan_write_probe_1.utf8Bytes)(activeContributorsJson) },
        { stateId: "excluded_contributors_json", value: excludedContributorsJson, bytes: (0, forecast_plan_write_probe_1.utf8Bytes)(excludedContributorsJson) },
        { stateId: "days_json", value: daysJson, bytes: (0, forecast_plan_write_probe_1.utf8Bytes)(daysJson) },
        {
            stateId: "slots_json",
            value: slotsJson,
            bytes: (0, forecast_plan_write_probe_1.utf8Bytes)(slotsJson),
            slotCount: plan.slots.length,
        },
        {
            stateId: "contributions_json",
            value: contributionsJson,
            bytes: (0, forecast_plan_write_probe_1.utf8Bytes)(contributionsJson),
            contributionCount: plan.contributions.length,
        },
        {
            stateId: "plan_json",
            value: planJson,
            bytes: (0, forecast_plan_write_probe_1.utf8Bytes)(planJson),
            slotCount: plan.slots.length,
            contributionCount: plan.contributions.length,
        },
    ];
    const uniqueSlotBytes = (0, forecast_plan_write_probe_1.utf8Bytes)(slotsJson);
    const uniqueContributionBytes = (0, forecast_plan_write_probe_1.utf8Bytes)(contributionsJson);
    return {
        activeContributorsJson,
        excludedContributorsJson,
        daysJson,
        slotsJson,
        contributionsJson,
        planJson,
        report: {
            fields,
            totalSerializedBytes: fields.reduce((sum, f) => sum + f.bytes, 0),
            uniqueSlotBytes,
            uniqueContributionBytes,
            duplicateSlotBytesVsPlanJson: (0, forecast_plan_write_probe_1.utf8Bytes)(slotsJson),
            duplicateContributionBytesVsPlanJson: (0, forecast_plan_write_probe_1.utf8Bytes)(contributionsJson),
        },
    };
}
exports.serializeForecastPlanForWrites = serializeForecastPlanForWrites;
