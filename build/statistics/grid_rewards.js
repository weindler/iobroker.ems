"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gridRewardsLabelDe = exports.resolvePeriodGridRewards = exports.resolveMonthGridRewards = exports.resolveTodayGridRewards = exports.netHomeGridCostEur = exports.gridRewardsCreditIsPresent = void 0;
function round2(n) {
    return Math.round(n * 100) / 100;
}
/**
 * Vorhandener/belastbarer Reward-Wert — nicht dasselbe wie „0,00 € erfunden“.
 * Schätzung 0 = nicht aufgelaufen / nicht anzeigen. Abrechnung 0 = echter vorhandener Wert.
 */
function gridRewardsCreditIsPresent(source, creditEur) {
    if (!source || source === "off")
        return false;
    if (creditEur === null || creditEur === undefined || !Number.isFinite(creditEur))
        return false;
    if (source === "billing")
        return creditEur >= 0;
    return creditEur > 0;
}
exports.gridRewardsCreditIsPresent = gridRewardsCreditIsPresent;
function positiveCredit(n) {
    if (n === null || !Number.isFinite(n))
        return null;
    const r = round2(n);
    return r > 0 ? r : null;
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
        const credit = positiveCredit(input.mappedDayEur);
        if (credit !== null) {
            return { creditEur: credit, source: "estimate_day" };
        }
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
        const credit = positiveCredit(input.mappedMonthEur);
        if (credit !== null) {
            return { creditEur: credit, source: "estimate_month" };
        }
    }
    return { creditEur: null, source: "off" };
}
exports.resolveMonthGridRewards = resolveMonthGridRewards;
/** Rewards über eine Periode: Abrechnung je Monat, sonst Schätzung (nur laufender Monat) bzw. Tages-Persist. */
function resolvePeriodGridRewards(input) {
    if (!input.enabled)
        return { creditEur: null, source: "off" };
    const prefixes = new Set();
    for (const d of input.dayCredits) {
        if (d.dateKey >= input.fromKey && d.dateKey <= input.toKey) {
            prefixes.add(d.dateKey.slice(0, 7));
        }
    }
    // auch Monate ohne Persist-Tage (nur Billing)
    const fromY = Number(input.fromKey.slice(0, 4));
    const fromM = Number(input.fromKey.slice(5, 7));
    const toY = Number(input.toKey.slice(0, 4));
    const toM = Number(input.toKey.slice(5, 7));
    let y = fromY;
    let m = fromM;
    while (y < toY || (y === toY && m <= toM)) {
        prefixes.add(`${y}-${String(m).padStart(2, "0")}`);
        m += 1;
        if (m > 12) {
            m = 1;
            y += 1;
        }
    }
    let total = 0;
    let hits = 0;
    let anyBilling = false;
    let anyEstimate = false;
    const currentPrefix = input.todayKey.slice(0, 7);
    for (const prefix of [...prefixes].sort()) {
        const billing = input.monthRewardsBilling[prefix];
        if (billing && billing.creditEur >= 0) {
            total += billing.creditEur;
            hits++;
            anyBilling = true;
            continue;
        }
        if (prefix === currentPrefix && input.mappedMonthEur !== null && input.mappedMonthEur >= 0) {
            const mapped = positiveCredit(input.mappedMonthEur);
            if (mapped !== null) {
                total += mapped;
                hits++;
                anyEstimate = true;
                continue;
            }
        }
        const daySum = input.dayCredits
            .filter((d) => d.dateKey.startsWith(prefix) && d.dateKey >= input.fromKey && d.dateKey <= input.toKey)
            .reduce((a, d) => a + (d.creditEur ?? 0), 0);
        if (daySum > 0) {
            total += daySum;
            hits++;
            anyEstimate = true;
        }
    }
    if (!hits)
        return { creditEur: null, source: "off" };
    const src = anyBilling && !anyEstimate ? "billing" : "estimate_month";
    return { creditEur: round2(total), source: src };
}
exports.resolvePeriodGridRewards = resolvePeriodGridRewards;
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
