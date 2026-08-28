"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gridRewardsLabelDe = exports.resolveMonthGridRewards = exports.resolveTodayGridRewards = exports.netHomeGridCostEur = void 0;
function round2(n) {
    return Math.round(n * 100) / 100;
}
/** Netto-Heim-Netz € nach Rewards-Gutschrift (nur Anzeige; max. Brutto-Netz). */
function netHomeGridCostEur(homeGridCostEur, rewardsCreditEur) {
    if (homeGridCostEur === null)
        return null;
    if (rewardsCreditEur === null || !(rewardsCreditEur > 0))
        return homeGridCostEur;
    return round2(Math.max(0, homeGridCostEur - Math.min(rewardsCreditEur, homeGridCostEur)));
}
exports.netHomeGridCostEur = netHomeGridCostEur;
function resolveTodayGridRewards(input) {
    if (!input.enabled) {
        return { creditEur: null, source: "off" };
    }
    if (input.mappedDayEur !== null && input.mappedDayEur >= 0) {
        return { creditEur: round2(input.mappedDayEur), source: "estimate_day" };
    }
    return { creditEur: null, source: "off" };
}
exports.resolveTodayGridRewards = resolveTodayGridRewards;
function resolveMonthGridRewards(input) {
    if (!input.enabled) {
        return { creditEur: null, source: "off" };
    }
    if (input.billingCreditEur !== null && input.billingCreditEur >= 0) {
        return { creditEur: round2(input.billingCreditEur), source: "billing" };
    }
    if (input.mappedMonthEur !== null && input.mappedMonthEur >= 0) {
        return { creditEur: round2(input.mappedMonthEur), source: "estimate_month" };
    }
    return { creditEur: null, source: "off" };
}
exports.resolveMonthGridRewards = resolveMonthGridRewards;
function gridRewardsLabelDe(source) {
    switch (source) {
        case "estimate_day":
        case "estimate_month":
            return "Grid Rewards Schätzung";
        case "billing":
            return "Abrechnung";
        default:
            return "";
    }
}
exports.gridRewardsLabelDe = gridRewardsLabelDe;
