"use strict";
/**
 * Neutral energy / charge-power math. Never invents 0 for missing SOC, capacity, power, or efficiency.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.chargingMinutesForEnergy = exports.computeEnergyNeed = exports.resolveChargePower = exports.evccDerivedChargePowerKw = exports.energyForSocDeltaKwh = exports.roundMinutes = exports.roundKwh = exports.EV_AC_VOLTAGE_V = void 0;
exports.EV_AC_VOLTAGE_V = 230;
const KWH_DECIMALS = 3;
const MIN_DECIMALS = 1;
function roundKwh(n) {
    return Math.round(n * 10 ** KWH_DECIMALS) / 10 ** KWH_DECIMALS;
}
exports.roundKwh = roundKwh;
function roundMinutes(n) {
    return Math.round(n * 10 ** MIN_DECIMALS) / 10 ** MIN_DECIMALS;
}
exports.roundMinutes = roundMinutes;
function positive(n) {
    return n != null && Number.isFinite(n) && n > 0 ? n : null;
}
/** AC energy needed to move SOC from current to target. Missing any input → null. */
function energyForSocDeltaKwh(input) {
    const { vehicleSocPct, targetSocPct, batteryCapacityKWh, chargingEfficiency } = input;
    if (vehicleSocPct == null ||
        targetSocPct == null ||
        batteryCapacityKWh == null ||
        chargingEfficiency == null) {
        return null;
    }
    if (!Number.isFinite(vehicleSocPct) ||
        !Number.isFinite(targetSocPct) ||
        !Number.isFinite(batteryCapacityKWh) ||
        !Number.isFinite(chargingEfficiency)) {
        return null;
    }
    if (batteryCapacityKWh <= 0 || chargingEfficiency <= 0)
        return null;
    const deltaPct = Math.max(0, targetSocPct - vehicleSocPct);
    const batteryKWh = batteryCapacityKWh * (deltaPct / 100);
    return roundKwh(batteryKWh / chargingEfficiency);
}
exports.energyForSocDeltaKwh = energyForSocDeltaKwh;
function evccDerivedChargePowerKw(input) {
    const currentAUsed = positive(input.effectiveMaxCurrentA) ??
        positive(input.maxCurrentA) ??
        positive(input.offeredCurrentA);
    const phasesUsed = positive(input.phasesConfigured) ??
        (input.phasesActive != null && input.phasesActive > 0 ? input.phasesActive : null);
    if (currentAUsed == null || phasesUsed == null) {
        return { powerKw: null, currentAUsed, phasesUsed };
    }
    return {
        powerKw: roundKwh((currentAUsed * phasesUsed * exports.EV_AC_VOLTAGE_V) / 1000),
        currentAUsed,
        phasesUsed,
    };
}
exports.evccDerivedChargePowerKw = evccDerivedChargePowerKw;
/**
 * 1) vehicle max AC  2) EVCC current×phases  3) configured max AC (same field if only config exists)
 * Never uses instantaneous chargePowerW (0 while paused is not available power).
 */
function resolveChargePower(model) {
    const vehicleMaxAcKw = positive(model.maxAcChargePowerKw);
    const evcc = evccDerivedChargePowerKw({
        effectiveMaxCurrentA: model.effectiveMaxCurrentA,
        maxCurrentA: model.maxCurrentA,
        offeredCurrentA: model.offeredCurrentA,
        phasesConfigured: model.phasesConfigured,
        phasesActive: model.phasesActive,
    });
    if (vehicleMaxAcKw != null && evcc.powerKw != null) {
        const chargePowerKw = Math.min(vehicleMaxAcKw, evcc.powerKw);
        return {
            chargePowerKw,
            source: chargePowerKw < vehicleMaxAcKw - 1e-9 ? "evcc_capped_by_vehicle" : "vehicle_max_ac",
            vehicleMaxAcKw,
            evccDerivedKw: evcc.powerKw,
            phasesUsed: evcc.phasesUsed,
            currentAUsed: evcc.currentAUsed,
        };
    }
    if (vehicleMaxAcKw != null) {
        return {
            chargePowerKw: vehicleMaxAcKw,
            source: "vehicle_max_ac",
            vehicleMaxAcKw,
            evccDerivedKw: evcc.powerKw,
            phasesUsed: evcc.phasesUsed,
            currentAUsed: evcc.currentAUsed,
        };
    }
    if (evcc.powerKw != null) {
        return {
            chargePowerKw: evcc.powerKw,
            source: "evcc_current_phases",
            vehicleMaxAcKw: null,
            evccDerivedKw: evcc.powerKw,
            phasesUsed: evcc.phasesUsed,
            currentAUsed: evcc.currentAUsed,
        };
    }
    return {
        chargePowerKw: null,
        source: "unknown",
        vehicleMaxAcKw: null,
        evccDerivedKw: null,
        phasesUsed: evcc.phasesUsed,
        currentAUsed: evcc.currentAUsed,
    };
}
exports.resolveChargePower = resolveChargePower;
function computeEnergyNeed(model, chargePowerKw) {
    const energyToTargetKWh = energyForSocDeltaKwh({
        vehicleSocPct: model.vehicleSocPct,
        targetSocPct: model.targetSocPct,
        batteryCapacityKWh: model.batteryCapacityKWh,
        chargingEfficiency: model.chargingEfficiency,
    });
    const energyToDepartureMinimumKWh = model.minimumDepartureSocPct == null
        ? null
        : energyForSocDeltaKwh({
            vehicleSocPct: model.vehicleSocPct,
            targetSocPct: model.minimumDepartureSocPct,
            batteryCapacityKWh: model.batteryCapacityKWh,
            chargingEfficiency: model.chargingEfficiency,
        });
    const minutesFrom = model.minimumDepartureSocPct != null ? energyToDepartureMinimumKWh : energyToTargetKWh;
    return {
        energyToTargetKWh,
        energyToDepartureMinimumKWh,
        requiredChargingMinutes: chargingMinutesForEnergy(minutesFrom, chargePowerKw),
        efficiencyUsed: model.chargingEfficiency,
    };
}
exports.computeEnergyNeed = computeEnergyNeed;
/** Minutes to deliver `energyKWh` at `chargePowerKw`. Unknown power/energy → null. */
function chargingMinutesForEnergy(energyKWh, chargePowerKw) {
    if (energyKWh == null || chargePowerKw == null || chargePowerKw <= 0)
        return null;
    return roundMinutes((Math.max(0, energyKWh) / chargePowerKw) * 60);
}
exports.chargingMinutesForEnergy = chargingMinutesForEnergy;
