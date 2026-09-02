"use strict";
/**
 * Stabilitätsfilter nur fürs Learning — die GB-Regelung bleibt unverändert unmittelbar.
 * Relativ + Mindesttoleranz, keine starre Wattgrenze für alle Betriebspunkte.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushStabilitySample = exports.isStabilityWindowStable = void 0;
const constants_1 = require("./constants");
function finiteOrNull(v) {
    return v != null && Number.isFinite(v) ? v : null;
}
function seriesStable(values, absFloor, relTol) {
    if (values.length < constants_1.STABILITY_MIN_SAMPLES)
        return false;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const mid = values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const scale = Math.max(Math.abs(mid), absFloor);
    return range <= Math.max(absFloor, relTol * scale);
}
/**
 * True, wenn alle vorhandenen relevanten Größen im Fenster ausreichend ruhig sind.
 * Fehlende Größen werden nicht als 0 erfunden — sie zählen nicht gegen Stabilität,
 * aber ohne Hauslast + GB (bzw. Grid) ist das Fenster nicht lernfähig.
 */
function isStabilityWindowStable(samples, opts) {
    const minSamples = opts?.minSamples ?? constants_1.STABILITY_MIN_SAMPLES;
    const relTol = opts?.relTol ?? constants_1.STABILITY_REL_TOL;
    if (samples.length < minSamples)
        return false;
    const window = samples.slice(-minSamples);
    const house = window.map((s) => finiteOrNull(s.houseW)).filter((v) => v != null);
    const pv = window.map((s) => finiteOrNull(s.pvW)).filter((v) => v != null);
    const grid = window.map((s) => finiteOrNull(s.gridW)).filter((v) => v != null);
    const gb = window.map((s) => finiteOrNull(s.gbEffectiveW)).filter((v) => v != null);
    if (house.length < minSamples)
        return false;
    if (!seriesStable(house, constants_1.STABILITY_ABS_FLOOR_HOUSE_W, relTol))
        return false;
    if (pv.length >= minSamples && !seriesStable(pv, constants_1.STABILITY_ABS_FLOOR_PV_W, relTol))
        return false;
    if (grid.length >= minSamples && !seriesStable(grid, constants_1.STABILITY_ABS_FLOOR_GRID_W, relTol))
        return false;
    if (gb.length >= minSamples && !seriesStable(gb, constants_1.STABILITY_ABS_FLOOR_GB_W, relTol))
        return false;
    return true;
}
exports.isStabilityWindowStable = isStabilityWindowStable;
function pushStabilitySample(buf, sample, max) {
    const next = buf.length >= max ? buf.slice(buf.length - max + 1) : buf.slice();
    next.push(sample);
    return next;
}
exports.pushStabilitySample = pushStabilitySample;
