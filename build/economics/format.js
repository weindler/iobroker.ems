"use strict";
/**
 * Nur Darstellung: Vorzeichen der Shadow-Netto-Kosten nicht umdrehen.
 * emsVorteilEur = reference_no_ems.netCost − real.netCost (positiv = EMS günstiger).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatNetCostPhraseDe = exports.formatEmsAdvantagePhraseDe = void 0;
function absEur(n) {
    return `${Math.abs(n).toFixed(2).replace(".", ",")} €`;
}
function formatEmsAdvantagePhraseDe(emsVorteilEur) {
    if (emsVorteilEur == null || !Number.isFinite(emsVorteilEur)) {
        return "EMS-Effekt nicht bewertbar";
    }
    if (emsVorteilEur > 0.005) {
        return `EMS hat ${absEur(emsVorteilEur)} gespart`;
    }
    if (emsVorteilEur < -0.005) {
        return `EMS verursachte ${absEur(emsVorteilEur)} Mehrkosten`;
    }
    return "EMS hat weder gespart noch Mehrkosten verursacht";
}
exports.formatEmsAdvantagePhraseDe = formatEmsAdvantagePhraseDe;
/** Netto-Kosten: negativ = Ertrag (Exportgutschrift > Bezug). */
function formatNetCostPhraseDe(netCostEur, roleDe) {
    if (netCostEur == null || !Number.isFinite(netCostEur)) {
        return `${roleDe}: —`;
    }
    if (netCostEur < -0.005) {
        return `${roleDe}: ${absEur(netCostEur)} Ertrag`;
    }
    if (netCostEur > 0.005) {
        return `${roleDe}: ${absEur(netCostEur)} Kosten`;
    }
    return `${roleDe}: 0,00 €`;
}
exports.formatNetCostPhraseDe = formatNetCostPhraseDe;
